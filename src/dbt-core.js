// src/dbt-core.js

/**
 * ソース名とテーブル名から物理テーブル名を生成する
 * "raw_" + tableName とする (sourceNameは含めない)
 */
export function generateSourceTableName(sourceName, tableName) {
    return `raw_${tableName}`;
}

/**
 * 依存関係の順序を決定する簡易ソートロジック
 */
export function sortNodesByPriority(nodes) {
    return nodes.sort((a, b) => {
        if (a.startsWith('stg_')) return -1;
        if (b.startsWith('stg_')) return 1;
        return 0;
    });
}