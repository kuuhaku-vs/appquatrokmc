const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  mcStatus: () => ipcRenderer.invoke('mc:status'),
  mcBuscar: (codigo) => ipcRenderer.invoke('mc:buscar', codigo),
  mcBuscaInteligente: (termo) => ipcRenderer.invoke('mc:buscaInteligente', termo),
  mcCopiar: (texto) => ipcRenderer.invoke('mc:copiar', texto),
  mcRecarregar: () => ipcRenderer.invoke('mc:recarregar'),
  abrirDados: () => ipcRenderer.invoke('dados:abrir'),
});
