export {};

declare global {
  interface Window {
    editor: {
      /** 编辑器后端地址，renderer 一切数据从此处取。 */
      backendUrl: string;
    };
  }
}
