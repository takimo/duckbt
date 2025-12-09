import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

// バンドルの手動定義 (バージョンの不整合を防ぐため v1.29.0 に固定)
const MANUAL_BUNDLES = {
    mvp: {
        mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-mvp.wasm',
        mainWorker: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-browser-mvp.worker.js',
    },
    eh: {
        mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-eh.wasm',
        mainWorker: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-browser-eh.worker.js',
    },
};

export class DuckDBManager {
    constructor() {
        this.db = null;
        this.conn = null;
    }

    /**
     * DuckDBを初期化し、接続を確立する
     */
    async init() {
        // 最適なバンドルを選択
        const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
        
        // Workerの作成
        const worker = await duckdb.createWorker(bundle.mainWorker);
        const logger = new duckdb.ConsoleLogger();
        
        // DBインスタンス化
        this.db = new duckdb.AsyncDuckDB(logger, worker);
        await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        
        // 接続
        this.conn = await this.db.connect();
    }

    /**
     * 外部URLのCSVファイルをDuckDBに登録する
     * @param {string} fileName - DB内での仮想ファイル名 (例: 'data.csv')
     * @param {string} url - データのURL
     */
    async registerFileURL(fileName, url) {
        if (!this.db) throw new Error("DB not initialized");
        // HTTPプロトコル経由でファイルを登録
        await this.db.registerFileURL(fileName, url, duckdb.DuckDBDataProtocol.HTTP, false);
    }

    /**
     * SQLを実行する
     * @param {string} sql 
     * @returns {Promise<Array>} 結果のオブジェクト配列
     */
    async query(sql) {
        if (!this.conn) throw new Error("DB connection not established");
        
        const result = await this.conn.query(sql);
        // Arrow形式の結果をJSON配列に変換して返す
        return result.toArray().map(row => row.toJSON());
    }

    /**
     * テーブル一覧を取得するユーティリティ
     */
    async getTables() {
        if (!this.conn) return [];
        const result = await this.conn.query("SHOW TABLES");
        return result.toArray().map(r => r.toJSON().name);
    }
}