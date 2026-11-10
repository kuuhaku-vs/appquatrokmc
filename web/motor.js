// Motor da Busca de MC para o navegador. Mesmas regras de src/mc-core.cjs (app de desktop),
// mas trabalhando sobre a base já carregada na memória: [[codigo, descricao, ncm], ...].
(function (raiz) {
  'use strict';

  // REGRA FIXA: POS.IPI / NCM -> CÓDIGO MC (manter igual a src/mc-core.cjs)
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

  const normalizarCodigo = (v) => String(v ?? '').trim().toUpperCase();
  const normalizarNcm = (v) => String(v ?? '').trim().replace(/[.\s-]/g, '');
  const semAcento = (v) => String(v ?? '').normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toUpperCase();

  function criarMotorWeb(base) {
    const indice = new Map();
    for (const linha of (base && base.produtos) || []) {
      const codigo = normalizarCodigo(linha[0]);
      if (codigo.length !== 12) continue;
      const descricao = String(linha[1] ?? '').trim();
      indice.set(codigo, { descricao, descNorm: semAcento(descricao), ncmOriginal: String(linha[2] ?? '').trim() });
    }

    function buscarMc(valor) {
      const codigo = normalizarCodigo(valor);
      if (codigo.length !== 12) {
        return { encontrado: false, mensagem: 'O código deve possuir exatamente 12 caracteres.', produto: { codigo } };
      }
      const produto = indice.get(codigo);
      if (!produto) return { encontrado: false, mensagem: 'Produto não encontrado.', produto: { codigo } };
      const descricao = produto.descricao;
      const ncm = normalizarNcm(produto.ncmOriginal);
      if (!ncm) {
        return { encontrado: false, mensagem: 'O produto não possui Pos.IPI/NCM cadastrado.', produto: { codigo, descricao } };
      }
      const codigoMc = MAPA_NCM_MC[ncm];
      if (!codigoMc) {
        return {
          encontrado: false, mensagem: 'Este Pos.IPI/NCM não possui uma regra de MC cadastrada.',
          produto: { codigo, descricao, ncm },
        };
      }
      return { encontrado: true, produto: { codigo, descricao, ncm }, mc: { codigo: codigoMc } };
    }

    function buscaInteligente(termo) {
      const original = String(termo ?? '').trim();
      const termoNorm = semAcento(original);
      const termoCodigo = normalizarCodigo(original);
      if (!termoNorm) return { encontrado: false, total: 0, resultados: [] };
      const achados = [];
      for (const [codigo, p] of indice) {
        const pos = p.descNorm.indexOf(termoNorm);
        const noCodigo = codigo.includes(termoCodigo);
        if (!noCodigo && pos < 0) continue;
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
        cache_carregado: true,
        cache_atualizando: false,
        produtos_12_digitos: indice.size,
        regras_ncm_mc: Object.keys(MAPA_NCM_MC).length,
        ultima_atualizacao: (base && base.geradoEm) || null,
        ultimo_erro: null,
      };
    }

    return { buscarMc, buscaInteligente, status };
  }

  const api = { criarMotorWeb, MAPA_NCM_MC };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.MotorMC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
