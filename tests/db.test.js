// tests/db.test.js
import { describe, it, expect } from 'vitest';
// ▼ 変更: https importを含まないファイルをテスト対象にする
import { generateSourceTableName, sortNodesByPriority } from '../src/dbt-core.js';

describe('dbt Core Logic', () => {
    it('should generate correct source table name', () => {
        const result = generateSourceTableName('ecommerce', 'orders');
        expect(result).toBe('raw_orders');
    });

    it('should sort staging models first', () => {
        const models = ['customers', 'stg_orders', 'orders'];
        const sorted = sortNodesByPriority(models);
        // stg_orders が最初に来るはず
        expect(sorted[0]).toBe('stg_orders');
    });
});