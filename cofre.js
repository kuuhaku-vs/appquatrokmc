// Cofre da base de produtos. O site é público, então a base fica CIFRADA (AES-256-GCM) e só
// abre com usuário e senha. Não existe servidor: a senha nunca sai do navegador.
//
//   chave do usuário = PBKDF2-SHA256(senha, sal, iterações)
//   chave da base    = AES-GCM(chave do usuário).decifrar(entrada do usuário em usuarios.json)
//   base             = gunzip(AES-GCM(chave da base).decifrar(base.bin))
//
// Usado pelo navegador (app.js) e pelo Node (tools/base.cjs e testes).
(function (raiz) {
  'use strict';
  const cripto = raiz.crypto;
  const ITERACOES = 600000;
  const txt = new TextEncoder();

  const b64 = (bytes) => {
    let s = '';
    const u = new Uint8Array(bytes);
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  };
  const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const hex = (bytes) => Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, '0')).join('');
  const normalizarUsuario = (u) => String(u ?? '').trim().toLowerCase();

  async function idUsuario(usuario) {
    return hex(await cripto.subtle.digest('SHA-256', txt.encode('busca-mc:' + normalizarUsuario(usuario)))).slice(0, 32);
  }

  async function chaveDoUsuario(usuario, senha, sal, iteracoes) {
    const material = await cripto.subtle.importKey(
      'raw', txt.encode(normalizarUsuario(usuario) + '\n' + String(senha ?? '')), 'PBKDF2', false, ['deriveKey']);
    return cripto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  const importarChaveBase = (bruta) =>
    cripto.subtle.importKey('raw', bruta, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

  async function fluxo(bytes, transformador) {
    const s = new Blob([bytes]).stream().pipeThrough(transformador);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  // ---------- abrir ----------
  // Devolve os 32 bytes da chave da base, ou lança Error('LOGIN') se usuário/senha não conferem.
  async function abrirChave(usuarios, usuario, senha) {
    const id = await idUsuario(usuario);
    const entrada = (usuarios.usuarios || []).find((u) => u.id === id);
    const iter = (usuarios.kdf && usuarios.kdf.iteracoes) || ITERACOES;
    if (!entrada) {
      // gasta o mesmo tempo de uma tentativa real
      await chaveDoUsuario(usuario, senha, new Uint8Array(16), iter);
      throw new Error('LOGIN');
    }
    const k = await chaveDoUsuario(usuario, senha, deB64(entrada.sal), iter);
    try {
      return new Uint8Array(await cripto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(entrada.iv) }, k, deB64(entrada.chave)));
    } catch {
      throw new Error('LOGIN');
    }
  }

  async function abrirBase(chaveBruta, baseBytes) {
    const u = new Uint8Array(baseBytes);
    const k = await importarChaveBase(chaveBruta);
    let claro;
    try {
      claro = await cripto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, k, u.slice(12));
    } catch {
      throw new Error('CHAVE');
    }
    const json = await fluxo(claro, new DecompressionStream('gzip'));
    return JSON.parse(new TextDecoder().decode(json));
  }

  // ---------- criar (usado pela ferramenta tools/base.cjs) ----------
  const novaChave = () => cripto.getRandomValues(new Uint8Array(32));

  async function fecharBase(chaveBruta, base) {
    const k = await importarChaveBase(chaveBruta);
    const iv = cripto.getRandomValues(new Uint8Array(12));
    const gz = await fluxo(txt.encode(JSON.stringify(base)), new CompressionStream('gzip'));
    const cifrado = new Uint8Array(await cripto.subtle.encrypt({ name: 'AES-GCM', iv }, k, gz));
    const saida = new Uint8Array(12 + cifrado.length);
    saida.set(iv, 0);
    saida.set(cifrado, 12);
    return saida;
  }

  async function entradaUsuario(chaveBruta, usuario, senha, iteracoes = ITERACOES) {
    const sal = cripto.getRandomValues(new Uint8Array(16));
    const iv = cripto.getRandomValues(new Uint8Array(12));
    const k = await chaveDoUsuario(usuario, senha, sal, iteracoes);
    const chave = await cripto.subtle.encrypt({ name: 'AES-GCM', iv }, k, chaveBruta);
    return { id: await idUsuario(usuario), sal: b64(sal), iv: b64(iv), chave: b64(chave) };
  }

  const api = { ITERACOES, abrirChave, abrirBase, novaChave, fecharBase, entradaUsuario, idUsuario, b64, deB64 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.CofreMC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
