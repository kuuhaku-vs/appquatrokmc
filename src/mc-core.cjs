'use strict';
// =========================================================
// BUSCA DE MC — MOTOR DE CONSULTA (Node puro, sem Python)
// =========================================================
// Mesmas regras do backend original (mc_backend/auth.py do NOVA):
//  - carrega primeiro o cache local e atualiza pelo Protheus em segundo plano;
//  - indexa somente códigos com exatamente 12 caracteres;
//  - converte Pos.IPI/NCM do produto em código MC por tabela fixa;
//  - busca inteligente por trecho de código ou de descrição, sem acentos.
// Este arquivo não depende do Electron, para poder ser testado com "node".

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// REGRA FIXA: POS.IPI / NCM -> CÓDIGO MC
const MAPA_NCM_MC = {
  '60062100': 'MC00001113',
  '60062400': 'MC00001114',
  '60062200': 'MC00001115',
  '60064100': 'MC00001116',
  '60064400': 'MC00001117',
  '60064200': 'MC00001118',
  '60063110': 'MC00001119',
  '60063120': 'MC00001119',
  '60063410': 'MC00001120',
  '60063420': 'MC00001120',
  '60063210': 'MC00001121',
  '60063220': 'MC00001121',
  '60069000': 'MC00001122',
  '60069001': 'MC00001122',
};

const RETAILITEM_PATH =
  '/rest/api/retail/v1/retailItem/?FIELDS=Code,ProductType,MercosulNomenclature,Description&Page=1&PageSize=100000000';

const normalizarCodigo = (v) => String(v ?? '').trim().toUpperCase();
const normalizarNcm = (v) => String(v ?? '').trim().replace(/[.\s-]/g, '');
// Sem acentos e sem diferença entre maiúsculas/minúsculas.
const semAcento = (v) => String(v ?? '').normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toUpperCase();
const segundos = (inicio) => Math.round((Number(process.hrtime.bigint() - inicio) / 1e9) * 1e4) / 1e4;

function criarMotor({ cacheFile, seedFile = null, getConfig = () => ({}), log = () => {} }) {
  let indice = new Map(); // codigo (12) -> { descricao, descNorm, ncmOriginal }
  let cacheCarregado = false;
  let atualizando = null; // Promise em andamento
  let ultimaAtualizacao = null; // ISO
  let ultimoErro = null;
  let timer = null;

  function prepararIndices(produtos) {
    const novo = new Map();
    for (const item of Array.isArray(produtos) ? produtos : []) {
      if (!item || typeof item !== 'object') continue;
      const codigo = normalizarCodigo(item.Code);
      if (codigo.length !== 12) continue; // só códigos de exatamente 12 caracteres
      const descricao = String(item.Description ?? item.description ?? '').trim();
      novo.set(codigo, {
        descricao,
        descNorm: semAcento(descricao),
        ncmOriginal: String(item.MercosulNomenclature ?? '').trim(),
      });
    }
    indice = novo;
    log(`Produtos com exatamente 12 caracteres: ${indice.size}`);
  }

  function carregarCacheArquivo() {
    try {
      if (!fs.existsSync(cacheFile) && seedFile && fs.existsSync(seedFile)) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.copyFileSync(seedFile, cacheFile);
        log('Cache inicial copiado do pacote.');
      }
      if (!fs.existsSync(cacheFile)) { log('Cache não encontrado.'); return false; }
      const produtos = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      prepararIndices(produtos);
      cacheCarregado = true;
      try { ultimaAtualizacao = fs.statSync(cacheFile).mtime.toISOString(); } catch {}
      log('Cache local carregado.');
      return true;
    } catch (e) {
      log('Erro ao carregar cache: ' + (e.message || e));
      return false;
    }
  }

  function salvarCache(texto) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const tmp = cacheFile + '.tmp';
      fs.writeFileSync(tmp, texto, 'utf8'); // grava em temporário para nunca corromper o cache
      fs.renameSync(tmp, cacheFile);
      log('Cache salvo.');
    } catch (e) { log('Erro ao salvar cache: ' + (e.message || e)); }
  }

  function consultarProtheus() {
    const cfg = (getConfig() || {}).protheus || {};
    const base = String(cfg.url || '').trim().replace(/\/+$/, '');
    if (!base || !cfg.usuario) {
      return Promise.reject(new Error('Protheus não configurado. Preencha url, usuario e senha em dados\\config.json.'));
    }
    return new Promise((resolve, reject) => {
      let u;
      try { u = new URL(base + RETAILITEM_PATH); } catch { return reject(new Error('URL do Protheus inválida em config.json.')); }
      const lib = u.protocol === 'https:' ? https : http;
      const inicio = Date.now();
      log('Consultando produtos no Protheus...');
      const req = lib.request(u, {
        method: 'GET',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${cfg.usuario}:${cfg.senha ?? ''}`, 'utf8').toString('base64'),
          Accept: 'application/json',
        },
        rejectUnauthorized: false, // servidor interno; o backend original também não validava SSL
      }, (res) => {
        const partes = [];
        res.on('data', (c) => partes.push(c));
        res.on('error', () => reject(new Error('Erro de conexão com Protheus.')));
        res.on('end', () => {
          const texto = Buffer.concat(partes).toString('utf8');
          log(`Status Protheus: ${res.statusCode} · ${((Date.now() - inicio) / 1000).toFixed(2)}s`);
          if (res.statusCode !== 200) {
            log('Resposta do Protheus: ' + texto.slice(0, 500));
            return reject(new Error('Erro Protheus: ' + res.statusCode + (res.statusCode === 401 ? ' (usuário ou senha recusados)' : '')));
          }
          let dados;
          try { dados = JSON.parse(texto); } catch { return reject(new Error('Resposta inválida recebida do Protheus.')); }
          const produtos = Array.isArray(dados?.items) ? dados.items : [];
          log(`Produtos recebidos: ${produtos.length} · hasNext: ${dados?.hasNext}`);
          resolve(produtos);
        });
      });
      req.setTimeout(120000, () => req.destroy(new Error('Tempo limite excedido ao consultar Protheus.')));
      req.on('error', (e) => reject(new Error(
        /Tempo limite/.test(e.message) ? e.message : 'Erro de conexão com Protheus. (' + (e.code || e.message) + ')')));
      req.end();
    });
  }

  // Atualiza o cache pelo Protheus. Chamadas simultâneas compartilham a mesma atualização.
  function atualizarCache() {
    if (atualizando) return atualizando;
    atualizando = (async () => {
      try {
        const produtos = await consultarProtheus();
        if (!produtos.length) throw new Error('O Protheus não retornou produtos; o cache atual foi mantido.');
        prepararIndices(produtos);
        salvarCache(JSON.stringify(produtos));
        cacheCarregado = true;
        ultimaAtualizacao = new Date().toISOString();
        ultimoErro = null;
        log('CACHE ATUALIZADO COM SUCESSO');
        return { ok: true, produtos: indice.size };
      } catch (e) {
        ultimoErro = e.message || String(e);
        log('Erro ao atualizar cache: ' + ultimoErro);
        return { ok: false, error: ultimoErro };
      } finally {
        atualizando = null;
      }
    })();
    return atualizando;
  }

  function iniciar() {
    log('INICIANDO SISTEMA DE CONSULTA MC');
    const existe = carregarCacheArquivo();
    log(existe ? `Cache local disponível: ${indice.size} produtos.` : 'Sem cache local; primeiro carregamento pelo Protheus.');
    atualizarCache(); // em segundo plano; o usuário já pode pesquisar
    const minutos = Math.max(1, Number((getConfig() || {}).atualizarMinutos) || 30);
    timer = setInterval(() => { log('Atualização automática do cache...'); atualizarCache(); }, minutos * 60 * 1000);
    if (timer.unref) timer.unref();
    return existe;
  }

  function parar() { if (timer) clearInterval(timer); timer = null; }

  function buscarMc(valor) {
    const inicio = process.hrtime.bigint();
    const codigo = normalizarCodigo(valor);
    if (codigo.length !== 12) {
      return { encontrado: false, mensagem: 'O código deve possuir exatamente 12 caracteres.', produto: { codigo } };
    }
    if (!cacheCarregado) {
      return {
        encontrado: false, carregando: true, produto: { codigo },
        mensagem: ultimoErro && !atualizando
          ? 'Ainda não há base de produtos neste computador. ' + ultimoErro
          : 'O sistema ainda está carregando os produtos. Tente novamente em alguns segundos.',
      };
    }
    const produto = indice.get(codigo);
    if (!produto) {
      return { encontrado: false, mensagem: 'Produto não encontrado.', produto: { codigo }, tempo_busca: segundos(inicio) };
    }
    const descricao = produto.descricao;
    const ncm = normalizarNcm(produto.ncmOriginal);
    if (!ncm) {
      return {
        encontrado: false, mensagem: 'O produto não possui Pos.IPI/NCM cadastrado.',
        produto: { codigo, descricao }, tempo_busca: segundos(inicio),
      };
    }
    const codigoMc = MAPA_NCM_MC[ncm];
    if (!codigoMc) {
      return {
        encontrado: false, mensagem: 'Este Pos.IPI/NCM não possui uma regra de MC cadastrada.',
        produto: { codigo, descricao, ncm }, tempo_busca: segundos(inicio),
      };
    }
    return { encontrado: true, produto: { codigo, descricao, ncm }, mc: { codigo: codigoMc }, tempo_busca: segundos(inicio) };
  }

  function buscaInteligente(termo) {
    const original = String(termo ?? '').trim();
    const termoNorm = semAcento(original);
    const termoCodigo = normalizarCodigo(original);
    if (!termoNorm) return { encontrado: false, total: 0, resultados: [] };
    if (!cacheCarregado) return { encontrado: false, carregando: true, total: 0, resultados: [] };
    const achados = [];
    for (const [codigo, p] of indice) {
      const pos = p.descNorm.indexOf(termoNorm);
      const noCodigo = codigo.includes(termoCodigo);
      if (!noCodigo && pos < 0) continue;
      // Nome exato/prefixo primeiro; depois código exato/trecho; depois posição no texto.
      let relevancia;
      if (p.descNorm === termoNorm) relevancia = 0;
      else if (pos === 0) relevancia = 1;
      else if (termoCodigo === codigo) relevancia = 2;
      else if (noCodigo) relevancia = 3;
      else relevancia = 4 + pos;
      achados.push({ codigo, descricao: p.descricao, relevancia });
    }
    achados.sort((a, b) => a.relevancia - b.relevancia || (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
    return {
      encontrado: achados.length > 0,
      total: achados.length,
      resultados: achados.slice(0, 100).map(({ codigo, descricao }) => ({ codigo, descricao })),
    };
  }

  function status() {
    return {
      cache_carregado: cacheCarregado,
      cache_atualizando: !!atualizando,
      produtos_12_digitos: indice.size,
      regras_ncm_mc: Object.keys(MAPA_NCM_MC).length,
      cache_arquivo: cacheFile,
      ultima_atualizacao: ultimaAtualizacao,
      ultimo_erro: ultimoErro,
    };
  }

  return { iniciar, parar, atualizarCache, carregarCacheArquivo, buscarMc, buscaInteligente, status };
}

module.exports = { criarMotor, MAPA_NCM_MC, normalizarCodigo, normalizarNcm, semAcento };
