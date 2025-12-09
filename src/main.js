import { DuckDBManager } from './db.js';
import { EditorManager } from './editor.js';
import { generateSourceTableName, sortNodesByPriority } from './dbt-core.js';

// --- CONFIGURATION ---
const LS_KEY_FILES = 'duckbt_files_ecommerce';
const LS_KEY_SOURCES = 'duckbt_sources_ecommerce';
const LS_KEY_LANG = 'duckbt_lang_pref';

// --- STATE ---
const defaultFiles = {
    'sources.yml': 
`version: 2

sources:
  - name: ecommerce
    tables:
      - name: invoices
`,
    'stg_invoices.sql':
`with source as (
    select * from {{ source('ecommerce', 'invoices') }}
),
renamed as (
    select
        "InvoiceNo" as invoice_id,
        "StockCode" as stock_code,
        "Description" as description,
        "Quantity"::INTEGER as quantity,
        "InvoiceDate" as invoice_date,
        "UnitPrice"::DOUBLE as unit_price,
        "CustomerID" as customer_id,
        "Country" as country
    from source
)
select * from renamed
where customer_id is not null
`,
    'customers.sql':
`with invoices as (
    select * from {{ ref('stg_invoices') }}
),
customer_orders as (
    select
        customer_id,
        country,
        min(invoice_date) as first_order_date,
        max(invoice_date) as most_recent_order_date,
        count(distinct invoice_id) as number_of_orders,
        sum(quantity * unit_price) as lifetime_value
    from invoices
    group by customer_id, country
)
select * from customer_orders
order by lifetime_value desc
`
};

// Application State
const state = {
    files: {},
    dataSources: [],
    activeFile: '',
    currentLang: 'ja'
};

// Instances
const dbManager = new DuckDBManager();
let editorManager = null;
let compiler = null;

// --- QUOTES ---
const quotes = [
    { ja: { text: "モデルは芸術だが、デプロイは戦争だ。", author: "- A. Kim" }, en: { text: "Models are art, but deployment is war.", author: "- A. Kim" } },
    { ja: { text: "真実は dbt run の先にある。", author: "- Unknown" }, en: { text: "The truth lies beyond 'dbt run'.", author: "- Unknown" } },
    { ja: { text: "NULLは値ではない。それは不在の証明だ。", author: "- C. Date" }, en: { text: "NULL is not a value. It is the proof of absence.", author: "- C. Date" } },
    { ja: { text: "リファクタリングを恐れるな。", author: "- J. Tanaka" }, en: { text: "Fear not refactoring.", author: "- J. Tanaka" } },
    { ja: { text: "テストのないモデルは、ただの願望に過ぎない。", author: "- S. Lee" }, en: { text: "A model without tests is just a wish.", author: "- S. Lee" } }
];

// --- INITIALIZATION ---
async function init() {
    initLanguage();
    renderQuote();
    updateDucklings(); // 初回のアヒル

    // 1. State Load
    loadState();
    
    // 2. Editor Init
    editorManager = new EditorManager('#code-editor', (newCode) => {
        if (state.activeFile && state.files[state.activeFile] !== undefined) {
            state.files[state.activeFile] = newCode;
            saveState();
        }
    });
    editorManager.init();

    // 3. DuckDB Init
    await dbManager.init();
    console.log("DuckDB Ready");

    // 4. Data Restore
    await restoreDataSources();
    setupCompiler();

    // 5. UI Setup
    setupUI();

    // 6. Initial Render
    renderSidebar();
    loadFile('customers.sql');
    refreshDbList();

    // Hide Splash
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if(splash) splash.classList.add('hidden');
    }, 2000);
}

// --- CORE LOGIC ---

function loadFile(filename) {
    if (!filename || !state.files[filename]) return;
    
    state.activeFile = filename;
    document.getElementById('current-filename').innerText = filename;
    
    // EditorManager経由でセット
    editorManager.setContent(state.files[filename], filename);
    
    renderSidebar();
}

function setupCompiler() {
    compiler = new nunjucks.Environment();
    compiler.addGlobal('ref', (name) => name); 
    compiler.addGlobal('source', (sourceName, tableName) => {
        // dbt-core.js のロジックを使用
        return generateSourceTableName(sourceName, tableName);
    });
}

async function runDbt() {
    switchTab('console');
    const consoleEl = document.getElementById('console-output');
    consoleEl.innerHTML = '';
    log("Starting dbt run...", "cmd");

    try {
        // YAMLチェック
        if (window.jsyaml) {
            window.jsyaml.load(state.files['sources.yml']); 
        }
        
        const nodes = Object.keys(state.files)
            .filter(f => f.endsWith('.sql'))
            .map(f => f.replace('.sql', ''));
        
        // dbt-core.js のロジックでソート
        const sortedNodes = sortNodesByPriority(nodes);

        // コンパイルチェック
        for (const modelName of sortedNodes) {
            const sql = state.files[`${modelName}.sql`];
            try { compiler.renderString(sql, {}); } catch(e) { throw new Error(`In ${modelName}.sql: ${e.message}`); }
        }

        // 実行 (CREATE VIEW)
        for (const modelName of sortedNodes) {
            log(`Running: ${modelName}`, "info");
            const compiledSql = compiler.renderString(state.files[`${modelName}.sql`], {});
            await dbManager.query(`CREATE OR REPLACE VIEW ${modelName} AS ${compiledSql}`);
            log(`OK created '${modelName}'`, "success");
        }
        
        log("dbt run completed.", "success");
        
        // プレビュー
        if (state.activeFile.endsWith('.sql')) {
            const currentModel = state.activeFile.replace('.sql', '');
            try {
                const result = await dbManager.query(`SELECT * FROM ${currentModel} LIMIT 50`);
                renderTable(result);
                switchTab('results');
            } catch(e) {}
        }
    } catch (e) {
        log(`Error: ${e.message}`, "error");
    }
}

// --- DATA MANAGEMENT ---

async function loadCsvToDb(url, tableName, useProxy, silent = false) {
    let fetchUrl = url;
    if (useProxy) {
        fetchUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
    }
    if (!silent) log(`Loading ${tableName}...`, "cmd");
    
    const tempName = `src_${tableName}.csv`;
    
    // DuckDBManager経由で登録
    await dbManager.registerFileURL(tempName, fetchUrl);
    // クエリ実行
    await dbManager.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${tempName}', ignore_errors=true)`);
    
    if (!silent) log(`Success: ${tableName} loaded.`, "success");
}

async function restoreDataSources() {
    if (state.dataSources.length === 0) return;
    log(`Restoring ${state.dataSources.length} datasets...`, "cmd");
    for (const source of state.dataSources) {
        try {
            await loadCsvToDb(source.url, source.tableName, source.useProxy, true); 
        } catch (e) {
            log(`Failed: ${source.tableName}`, "error");
        }
    }
}

// --- STATE PERSISTENCE ---

function loadState() {
    const savedFiles = localStorage.getItem(LS_KEY_FILES);
    const savedSources = localStorage.getItem(LS_KEY_SOURCES);
    
    state.files = savedFiles ? JSON.parse(savedFiles) : JSON.parse(JSON.stringify(defaultFiles));
    state.dataSources = savedSources ? JSON.parse(savedSources) : [];
    
    if (!state.dataSources.some(s => s.tableName === 'raw_invoices')) {
        state.dataSources.push({
            url: 'https://raw.githubusercontent.com/databricks/Spark-The-Definitive-Guide/master/data/retail-data/all/online-retail-dataset.csv',
            tableName: 'raw_invoices',
            useProxy: true 
        });
    }
}

function saveState() {
    localStorage.setItem(LS_KEY_FILES, JSON.stringify(state.files));
    localStorage.setItem(LS_KEY_SOURCES, JSON.stringify(state.dataSources));
}

// --- UI EVENT HANDLERS ---

function setupUI() {
    document.getElementById('file-item-sources').onclick = () => loadFile('sources.yml');
    document.getElementById('btn-run').onclick = runDbt;
    document.getElementById('btn-save').onclick = () => { saveState(); log(`Saved: ${state.activeFile}`, "info"); };
    document.getElementById('btn-add-file').onclick = addNewFile;
    document.getElementById('btn-refresh-db').onclick = refreshDbList;
    
    // Modal
    const modal = document.getElementById('modal-load-data');
    document.getElementById('btn-load-data').onclick = () => { modal.style.display = 'flex'; };
    window.closeModal = () => { modal.style.display = 'none'; };
    
    // Execute Load Data Button
    window.executeLoadData = async () => {
        const url = document.getElementById('input-csv-url').value;
        const tableName = document.getElementById('input-table-name').value;
        const useProxy = document.getElementById('input-use-proxy').checked;
        if (!url || !tableName) return alert("Required fields missing");
        
        closeModal();
        switchTab('console');
        try {
            await loadCsvToDb(url, tableName, useProxy);
            
            // Update State
            const idx = state.dataSources.findIndex(s => s.tableName === tableName);
            const entry = { url, tableName, useProxy };
            if (idx >= 0) state.dataSources[idx] = entry;
            else state.dataSources.push(entry);
            saveState();
            
            await refreshDbList();
            const res = await dbManager.query(`SELECT * FROM ${tableName} LIMIT 5`);
            renderTable(res);
            switchTab('results');
        } catch (e) {
            log(`Error: ${e.message}`, "error");
        }
    };

    // Lang Toggle
    const btnLang = document.getElementById('btn-lang-toggle');
    if(btnLang) btnLang.onclick = toggleLanguage;
    const splashToggle = document.getElementById('lang-toggle');
    if(splashToggle) splashToggle.onclick = toggleLanguage;
    
    // Reset
    window.resetProject = async () => {
        if (!confirm("⚠️ Reset all data?")) return;
        localStorage.removeItem(LS_KEY_FILES);
        localStorage.removeItem(LS_KEY_SOURCES);
        localStorage.removeItem(LS_KEY_LANG);
        location.reload();
    };
}

// --- UI RENDERING ---

function renderSidebar() {
    const list = document.getElementById('file-list');
    list.innerHTML = '';
    
    const srcItem = document.getElementById('file-item-sources');
    if (state.activeFile === 'sources.yml') srcItem.classList.add('active');
    else srcItem.classList.remove('active');

    const sqlFiles = Object.keys(state.files).filter(f => f.endsWith('.sql')).sort();
    sqlFiles.forEach(filename => {
        const li = document.createElement('li');
        li.className = `file-item ${filename === state.activeFile ? 'active' : ''}`;
        
        const span = document.createElement('span');
        span.innerHTML = `<span class="file-icon sql-icon">📄</span>${filename}`;
        span.style.flex = "1";
        span.onclick = () => loadFile(filename);
        
        const del = document.createElement('span');
        del.className = 'delete-btn';
        del.innerText = '🗑';
        del.onclick = (e) => {
            e.stopPropagation();
            if(confirm(`Delete ${filename}?`)) {
                delete state.files[filename];
                saveState();
                if(state.activeFile === filename) loadFile('sources.yml');
                else renderSidebar();
            }
        };
        
        li.appendChild(span);
        li.appendChild(del);
        list.appendChild(li);
    });
}

function addNewFile() {
    let name = prompt("Model Name:");
    if (!name) return;
    if (!name.endsWith('.sql')) name += '.sql';
    if (state.files[name]) return alert("Exists.");
    state.files[name] = `-- New model\nSELECT * FROM {{ ref('customers') }}`;
    saveState();
    loadFile(name);
}

function log(msg, type) {
    const c = document.getElementById('console-output');
    const p = document.createElement('p');
    p.className = `log-${type}`;
    p.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    c.appendChild(p);
    c.scrollTop = c.scrollHeight;
}

function renderTable(rows) {
    const container = document.getElementById('result-table-container');
    // DuckDBManager.queryで既にJSON配列になっている前提
    if (!rows || rows.length === 0) { container.innerHTML = '<p>No data</p>'; return; }
    
    const headers = Object.keys(rows[0]);
    let html = '<table class="data-table"><thead><tr>' + 
        headers.map(h => `<th>${h}</th>`).join('') + 
        '</tr></thead><tbody>';
        
    rows.forEach(r => {
        html += '<tr>' + headers.map(h => {
            let v = r[h];
            if(v === null) v = '<span class="null-value">null</span>';
            else if(typeof v === 'object' && !(v instanceof Date)) v = JSON.stringify(v);
            return `<td>${v}</td>`;
        }).join('') + '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

async function refreshDbList() {
    const list = document.getElementById('db-list');
    list.innerHTML = '<li>Loading...</li>';
    try {
        const tbls = await dbManager.getTables();
        list.innerHTML = '';
        tbls.forEach(t => {
            const li = document.createElement('li');
            li.className = 'db-item';
            li.innerText = `📦 ${t}`;
            li.onclick = async () => {
                const r = await dbManager.query(`SELECT * FROM ${t} LIMIT 10`);
                renderTable(r);
                switchTab('results');
            };
            list.appendChild(li);
        });
    } catch(e) {}
}

window.switchTab = (tab) => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab')[tab === 'console' ? 0 : 1].classList.add('active');
    document.getElementById('console-output').style.display = tab === 'console' ? 'block' : 'none';
    document.getElementById('result-table-container').style.display = tab === 'results' ? 'block' : 'none';
};

// --- I18N & ANIMATION ---

function initLanguage() {
    const saved = localStorage.getItem(LS_KEY_LANG);
    if(saved) state.currentLang = saved;
    else state.currentLang = (navigator.language || '').startsWith('ja') ? 'ja' : 'en';
    updateLangBtn();
}

function updateLangBtn() {
    const txt = `🌐 Lang: ${state.currentLang.toUpperCase()}`;
    const btn = document.getElementById('btn-lang-toggle');
    if(btn) btn.innerText = txt;
    
    const splashLabel = document.getElementById('lang-label');
    if(splashLabel) {
        splashLabel.innerText = state.currentLang === 'ja' ? 'English' : '日本語';
    }
}

function toggleLanguage() {
    state.currentLang = state.currentLang === 'ja' ? 'en' : 'ja';
    localStorage.setItem(LS_KEY_LANG, state.currentLang);
    updateLangBtn();
    renderQuote();
}

function renderQuote() {
    const q = quotes[Math.floor(Math.random() * quotes.length)][state.currentLang];
    const qEl = document.getElementById('splash-quote');
    if(qEl) {
        qEl.innerText = `"${q.text}"`;
        document.getElementById('splash-author').innerText = q.author;
    }
}

function updateDucklings() {
    const container = document.getElementById('duck-container');
    if(!container) return;
    
    container.querySelectorAll('.duckling').forEach(d => d.remove());
    
    const count = Math.floor(Math.random() * 4);
    for(let i=0; i<count; i++) {
        const d = document.createElement('div');
        d.className = 'duckling';
        d.innerText = '🦆';
        d.style.animationDelay = `${i * 0.2}s`;
        container.appendChild(d); // flexbox order: 親の次
    }
}

const duckC = document.getElementById('duck-container');
if(duckC) {
    duckC.addEventListener('animationiteration', (e) => {
        if(e.animationName === 'wander') updateDucklings();
    });
}

// 変更後：DOMの読み込み完了を待ってから実行
window.addEventListener('DOMContentLoaded', () => {
    init();
});