// Versão web da Busca de MC: tela de login + ponte "window.api" usada pela tela (a mesma do app de desktop).
(function () {
  'use strict';
  const CHAVE_SALVA = 'buscamc_chave_v1';
  const $ = (id) => document.getElementById(id);
  let motor = null;
  let aoEntrar;
  const pronto = new Promise((r) => { aoEntrar = r; });

  async function copiar(texto) {
    const valor = String(texto || '').trim();
    if (!valor) return { ok: false };
    try {
      await navigator.clipboard.writeText(valor);
      return { ok: true };
    } catch {
      // navegadores que só copiam dentro de um gesto do usuário
      const ativo = document.activeElement;
      const t = document.createElement('textarea');
      t.value = valor;
      t.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      t.remove();
      if (ativo && ativo.focus) ativo.focus();
      if (!ok) throw new Error('O navegador bloqueou a cópia automática. Use o botão ao lado do código MC.');
      return { ok };
    }
  }

  // A tela chama estas funções; antes do login elas simplesmente esperam.
  window.api = {
    mcStatus: async () => (motor ? motor.status() : { cache_carregado: false, cache_atualizando: false, produtos_12_digitos: 0 }),
    mcBuscar: async (codigo) => { await pronto; return motor.buscarMc(codigo); },
    mcBuscaInteligente: async (termo) => { await pronto; return motor.buscaInteligente(termo); },
    mcCopiar: copiar,
  };

  const buscarArquivo = async (caminho, tipo) => {
    const r = await fetch(caminho, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Não foi possível baixar ' + caminho + ' (HTTP ' + r.status + ').');
    return tipo === 'json' ? r.json() : r.arrayBuffer();
  };

  async function abrirComChave(chave) {
    const base = await CofreMC.abrirBase(chave, await buscarArquivo('dados/base.bin'));
    motor = MotorMC.criarMotorWeb(base);
    $('loginOverlay').classList.add('hidden');
    aoEntrar();
    const campo = $('codigo');
    if (campo) campo.focus();
  }

  function erro(msg) {
    const e = $('loginErro');
    e.textContent = msg;
    e.classList.toggle('hidden', !msg);
  }

  async function entrar(ev) {
    ev.preventDefault();
    const botao = $('loginEntrar');
    const usuario = $('loginUsuario').value;
    const senha = $('loginSenha').value;
    if (!usuario.trim() || !senha) { erro('Informe usuário e senha.'); return; }
    erro('');
    botao.disabled = true;
    botao.textContent = 'Entrando...';
    try {
      const usuarios = await buscarArquivo('dados/usuarios.json', 'json');
      const chave = await CofreMC.abrirChave(usuarios, usuario, senha);
      await abrirComChave(chave);
      $('loginSenha').value = '';
      try {
        if ($('loginLembrar').checked) localStorage.setItem(CHAVE_SALVA, CofreMC.b64(chave));
        else localStorage.removeItem(CHAVE_SALVA);
      } catch {}
    } catch (e) {
      erro(e.message === 'LOGIN' ? 'Usuário ou senha incorretos.'
        : e.message === 'CHAVE' ? 'A base foi atualizada. Entre novamente com usuário e senha.'
        : (e.message || String(e)));
    } finally {
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  }

  function sair() {
    try { localStorage.removeItem(CHAVE_SALVA); } catch {}
    location.reload();
  }

  async function iniciar() {
    $('loginForm').addEventListener('submit', entrar);
    $('btnSair').addEventListener('click', sair);
    let salva = null;
    try { salva = localStorage.getItem(CHAVE_SALVA); } catch {}
    if (salva) {
      try { await abrirComChave(CofreMC.deB64(salva)); return; } catch {
        try { localStorage.removeItem(CHAVE_SALVA); } catch {}
      }
    }
    $('loginOverlay').classList.remove('hidden');
    $('loginUsuario').focus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ---- Instalar como aplicativo ----
  // Chrome/Edge/Samsung (Android e computador): usa o aviso nativo de instalação.
  // iPhone/iPad e navegadores sem aviso nativo: mostra o passo a passo manual.
  const jaInstalado = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const ua = navigator.userAgent;
  const ehIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ehAndroid = /Android/i.test(ua);
  let avisoNativo = null;

  const botoesInstalar = () => [$('btnInstalar'), $('lgInstalar')].filter(Boolean);
  const mostrarBotoes = (sim) => botoesInstalar().forEach((b) => b.classList.toggle('hidden', !sim));

  function passoAPasso() {
    let passos;
    if (ehIOS) {
      passos = /CriOS|FxiOS|EdgiOS/.test(ua)
        ? ['Toque no botão <b>Compartilhar</b> (quadrado com seta ↑) na barra de endereço.',
           'Escolha <b>Adicionar à Tela de Início</b>.',
           'Toque em <b>Adicionar</b>. Se a opção não aparecer, abra este site no <b>Safari</b>.']
        : ['Toque no botão <b>Compartilhar</b> (quadrado com seta ↑) na barra do Safari.',
           'Role a lista e toque em <b>Adicionar à Tela de Início</b>.',
           'Toque em <b>Adicionar</b>. O ícone da Busca de MC aparece na tela inicial.'];
    } else if (ehAndroid) {
      passos = ['Abra o menu do navegador (<b>⋮</b> no canto superior).',
        'Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.',
        'Confirme. Se não aparecer, abra este site no <b>Chrome</b>.'];
    } else {
      passos = ['No <b>Chrome</b> ou <b>Edge</b>, clique no ícone de instalar (<b>⊕</b> ou monitor com seta) no fim da barra de endereço.',
        'Ou abra o menu <b>⋮</b> / <b>…</b> e escolha <b>Instalar Busca de MC</b> (no Edge: <b>Aplicativos › Instalar este site</b>).',
        'O Firefox no computador não instala sites; use Chrome ou Edge.'];
    }
    $('iaPassos').innerHTML = passos.map((p) => '<li>' + p + '</li>').join('');
    $('instalarAjuda').classList.remove('hidden');
  }

  async function instalar() {
    if (avisoNativo) {
      const aviso = avisoNativo;
      avisoNativo = null;
      aviso.prompt();
      try {
        const { outcome } = await aviso.userChoice;
        if (outcome === 'accepted') mostrarBotoes(false);
      } catch {}
      return;
    }
    passoAPasso();
  }

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    avisoNativo = ev;
    if (!jaInstalado()) mostrarBotoes(true);
  });
  window.addEventListener('appinstalled', () => { avisoNativo = null; mostrarBotoes(false); });

  function prepararInstalacao() {
    botoesInstalar().forEach((b) => b.addEventListener('click', instalar));
    const fechar = () => $('instalarAjuda').classList.add('hidden');
    $('iaFechar').addEventListener('click', fechar);
    $('instalarAjuda').addEventListener('click', (ev) => { if (ev.target.id === 'instalarAjuda') fechar(); });
    // No iPhone/iPad não existe aviso nativo: o botão abre o passo a passo.
    if (!jaInstalado() && ehIOS) mostrarBotoes(true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepararInstalacao);
  else prepararInstalacao();
})();
