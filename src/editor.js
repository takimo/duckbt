import { CodeJar } from 'https://medv.io/codejar/codejar.js';

export class EditorManager {
    /**
     * @param {string} selector - エディタとなるDOM要素のセレクタ (例: '#code-editor')
     * @param {function} onUpdate - コードが変更された時に呼ばれるコールバック関数
     */
    constructor(selector, onUpdate) {
        this.element = document.querySelector(selector);
        this.onUpdate = onUpdate;
        this.jar = null;
        this.currentExtension = 'sql'; // デフォルト
    }

    init() {
        const highlight = (editor) => {
            // 拡張子に応じてクラスを切り替え
            if (this.currentExtension === 'yml' || this.currentExtension === 'yaml') {
                editor.className = 'language-yaml';
            } else {
                editor.className = 'language-sql';
            }
            
            // Prism.js がロードされていればハイライト適用
            if (window.Prism) {
                window.Prism.highlightElement(editor);
            }
        };

        this.jar = CodeJar(this.element, highlight);

        // 入力ごとのイベント
        this.jar.onUpdate(code => {
            if (this.onUpdate) {
                this.onUpdate(code);
            }
        });
    }

    /**
     * エディタの内容とハイライトモードを更新する
     * @param {string} code - 表示するコード
     * @param {string} filename - ファイル名 (拡張子判定用)
     */
    setContent(code, filename) {
        // 拡張子を判定
        if (filename.endsWith('.yml') || filename.endsWith('.yaml')) {
            this.currentExtension = 'yaml';
        } else {
            this.currentExtension = 'sql';
        }

        // コードをセット (これにより highlight も再実行される)
        this.jar.updateCode(code);
    }
}
