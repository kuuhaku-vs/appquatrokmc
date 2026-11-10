'use strict';
// Testes do motor de busca (sem Electron e sem rede externa): node --test test/motor.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarMotor, normalizarNcm, semAcento } = require('../src/mc-core.cjs');

// Dados fictícios, só para teste.
const PRODUTOS = [
  { Code: 'AAAAAAAAAAAA   ', MercosulNomenclature: '6006.21.00', Description: 'MALHA ALGODÃO CRU ' },
  { Code: 'BBBBBBBBBBBB', MercosulNomenclature: '60063420  ', Description: 'MALHA AÇÃO TINTA' },
  { Code: 'CCCCCCCCCCCC', MercosulNomenclature: '', Description: 'SEM NCM' },
  { Code: 'DDDDDDDDDDDD', MercosulNomenclature: '99999999', Description: 'NCM SEM REGRA' },
  { Code: 'CURTO', MercosulNomenclature: '60062100', Description: 'CODIGO CURTO' },
];

function novoMotor(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-'));
  const seedFile = path.join(dir, 'seed.json');
  fs.writeFileSync(seedFile, JSON.stringify(PRODUTOS));
  const logs = [];
  const motor = criarMotor({
    cacheFile: path.join(dir, 'dados', 'produtos_cache.json'),
    seedFile,
    log: (s) => logs.push(s),
    ...extra,
  });
  return { motor, dir, logs };
}

test('normalização', () => {
  assert.equal(normalizarNcm(' 6006.34-20 '), '60063420');
  assert.equal(semAcento('Algodão Açaí'), 'ALGODAO ACAI');
});

test('antes de carregar a base, avisa que está carregando', () => {
  const { motor } = novoMotor();
  assert.equal(motor.buscarMc('AAAAAAAAAAAA').carregando, true);
  assert.equal(motor.buscaInteligente('malha').carregando, true);
});

test('buscar MC: regras do backend original', () => {
  const { motor } = novoMotor();
  assert.equal(motor.carregarCacheArquivo(), true);
  assert.equal(motor.status().produtos_12_digitos, 4); // só códigos de 12 caracteres

  const ok = motor.buscarMc('  aaaaaaaaaaaa ');
  assert.equal(ok.encontrado, true);
  assert.deepEqual(ok.mc, { codigo: 'MC00001113' });
  assert.deepEqual(ok.produto, { codigo: 'AAAAAAAAAAAA', descricao: 'MALHA ALGODÃO CRU', ncm: '60062100' });
  assert.equal(motor.buscarMc('BBBBBBBBBBBB').mc.codigo, 'MC00001120');

  assert.equal(motor.buscarMc('CCCCCCCCCCCC').mensagem, 'O produto não possui Pos.IPI/NCM cadastrado.');
  assert.equal(motor.buscarMc('DDDDDDDDDDDD').mensagem, 'Este Pos.IPI/NCM não possui uma regra de MC cadastrada.');
  assert.equal(motor.buscarMc('ZZZZZZZZZZZZ').mensagem, 'Produto não encontrado.');
  assert.equal(motor.buscarMc('CURTO').mensagem, 'O código deve possuir exatamente 12 caracteres.');
});

test('busca inteligente: sem acento, por código ou descrição, ordenada por relevância', () => {
  const { motor } = novoMotor();
  motor.carregarCacheArquivo();
  assert.deepEqual(motor.buscaInteligente('acao').resultados.map((r) => r.codigo), ['BBBBBBBBBBBB']);
  assert.deepEqual(motor.buscaInteligente('malha').resultados.map((r) => r.codigo), ['AAAAAAAAAAAA', 'BBBBBBBBBBBB']);
  assert.deepEqual(motor.buscaInteligente('bbbb').resultados.map((r) => r.codigo), ['BBBBBBBBBBBB']);
  assert.equal(motor.buscaInteligente('sem ncm').resultados[0].codigo, 'CCCCCCCCCCCC'); // descrição exata primeiro
  assert.deepEqual(motor.buscaInteligente('nada-disso'), { encontrado: false, total: 0, resultados: [] });
  assert.deepEqual(motor.buscaInteligente('   '), { encontrado: false, total: 0, resultados: [] });
});

test('atualização pelo Protheus (servidor simulado)', async () => {
  let modo = 'ok';
  let visto = {};
  const srv = http.createServer((req, res) => {
    visto = { url: req.url };
    if (req.headers.authorization !== 'Basic ' + Buffer.from('user:s3nh@').toString('base64')) {
      res.statusCode = 401;
      return res.end('nao');
    }
    if (modo === 'lixo') return res.end('<html>');
    if (modo === 'vazio') return res.end(JSON.stringify({ items: [], hasNext: false }));
    res.end(JSON.stringify({ hasNext: false, items: [
      { Code: 'EEEEEEEEEEEE', MercosulNomenclature: '60064100', Description: 'PRODUTO NOVO' },
      { Code: 'CURTO', MercosulNomenclature: '60064100', Description: 'x' },
    ] }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const cfg = { protheus: { url: `http://127.0.0.1:${srv.address().port}/`, usuario: 'user', senha: 's3nh@' } };
  const { motor, dir, logs } = novoMotor({ getConfig: () => cfg });
  const cacheFile = path.join(dir, 'dados', 'produtos_cache.json');
  motor.carregarCacheArquivo();

  const [a, b] = await Promise.all([motor.atualizarCache(), motor.atualizarCache()]);
  assert.deepEqual(a, { ok: true, produtos: 1 });
  assert.strictEqual(a, b); // chamadas simultâneas compartilham a mesma atualização
  assert.ok(visto.url.startsWith('/rest/api/retail/v1/retailItem/?FIELDS=Code,ProductType,MercosulNomenclature,Description&Page=1&PageSize='));
  assert.equal(motor.buscarMc('EEEEEEEEEEEE').mc.codigo, 'MC00001116');
  assert.equal(motor.buscarMc('AAAAAAAAAAAA').mensagem, 'Produto não encontrado.');
  assert.equal(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).length, 2);
  assert.ok(!fs.existsSync(cacheFile + '.tmp'));

  // Falhas nunca derrubam a base que já estava carregada.
  for (const [md, senha, rx] of [['vazio', 's3nh@', /não retornou produtos/], ['lixo', 's3nh@', /Resposta inválida/], ['ok', 'errada', /401/]]) {
    modo = md;
    cfg.protheus.senha = senha;
    const r = await motor.atualizarCache();
    assert.equal(r.ok, false);
    assert.match(r.error, rx);
    assert.equal(motor.buscarMc('EEEEEEEEEEEE').encontrado, true);
    assert.match(motor.status().ultimo_erro, rx);
  }

  await new Promise((r) => srv.close(r));
  cfg.protheus.senha = 's3nh@';
  assert.match((await motor.atualizarCache()).error, /Erro de conexão com Protheus/);
  cfg.protheus = { url: '', usuario: '', senha: '' };
  assert.match((await motor.atualizarCache()).error, /não configurado/);
  assert.ok(!logs.join('\n').includes('s3nh@'), 'a senha não pode aparecer no log');
});

test('sem base e sem Protheus: a mensagem explica o motivo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-'));
  const motor = criarMotor({ cacheFile: path.join(dir, 'produtos_cache.json') });
  assert.equal(motor.carregarCacheArquivo(), false);
  await motor.atualizarCache();
  const r = motor.buscarMc('AAAAAAAAAAAA');
  assert.equal(r.encontrado, false);
  assert.match(r.mensagem, /Ainda não há base de produtos.*não configurado/);
});
