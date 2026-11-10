'use strict';
// Testes do site: regras da busca e cofre (cifra/login). Rodar com: npm test
const test = require('node:test');
const assert = require('node:assert');
const { criarMotorWeb } = require('../motor.js');
const cofre = require('../cofre.js');

// Dados fictícios, só para teste.
const BASE = { v: 1, geradoEm: '2026-01-02T03:04:05.000Z', produtos: [
  ['AAAAAAAAAAAA', 'MALHA ALGODÃO CRU', '6006.21.00'],
  ['BBBBBBBBBBBB', 'MALHA AÇÃO TINTA', '60063420'],
  ['CCCCCCCCCCCC', 'SEM NCM', ''],
  ['DDDDDDDDDDDD', 'NCM SEM REGRA', '99999999'],
  ['CURTO', 'CODIGO CURTO', '60062100'],
] };

test('buscar MC', () => {
  const m = criarMotorWeb(BASE);
  assert.equal(m.status().produtos_12_digitos, 4); // só códigos de 12 caracteres
  assert.deepEqual(m.buscarMc('  aaaaaaaaaaaa '), {
    encontrado: true,
    produto: { codigo: 'AAAAAAAAAAAA', descricao: 'MALHA ALGODÃO CRU', ncm: '60062100' },
    mc: { codigo: 'MC00001113' },
  });
  assert.equal(m.buscarMc('BBBBBBBBBBBB').mc.codigo, 'MC00001120');
  assert.equal(m.buscarMc('CCCCCCCCCCCC').mensagem, 'O produto não possui Pos.IPI/NCM cadastrado.');
  assert.equal(m.buscarMc('DDDDDDDDDDDD').mensagem, 'Este Pos.IPI/NCM não possui uma regra de MC cadastrada.');
  assert.equal(m.buscarMc('ZZZZZZZZZZZZ').mensagem, 'Produto não encontrado.');
  assert.equal(m.buscarMc('CURTO').mensagem, 'O código deve possuir exatamente 12 caracteres.');
});

test('busca inteligente: sem acento, por código ou descrição, por relevância', () => {
  const m = criarMotorWeb(BASE);
  assert.deepEqual(m.buscaInteligente('acao').resultados.map((r) => r.codigo), ['BBBBBBBBBBBB']);
  assert.deepEqual(m.buscaInteligente('malha').resultados.map((r) => r.codigo), ['AAAAAAAAAAAA', 'BBBBBBBBBBBB']);
  assert.deepEqual(m.buscaInteligente('bbbb').resultados.map((r) => r.codigo), ['BBBBBBBBBBBB']);
  assert.equal(m.buscaInteligente('sem ncm').resultados[0].codigo, 'CCCCCCCCCCCC');
  assert.deepEqual(m.buscaInteligente('nada-disso'), { encontrado: false, total: 0, resultados: [] });
  assert.deepEqual(m.buscaInteligente('   '), { encontrado: false, total: 0, resultados: [] });
});

test('cofre: só abre com usuário e senha corretos', async () => {
  const chave = cofre.novaChave();
  const cifrada = await cofre.fecharBase(chave, BASE);
  assert.ok(!Buffer.from(cifrada).toString('latin1').includes('MALHA'), 'a base cifrada não pode ter texto legível');
  const usuarios = { v: 1, kdf: { iteracoes: 1000 }, usuarios: [
    await cofre.entradaUsuario(chave, 'Ana', 'senha-da-ana-123', 1000),
    await cofre.entradaUsuario(chave, 'beto', 'senha-do-beto-456', 1000),
  ] };
  assert.ok(!JSON.stringify(usuarios).toLowerCase().includes('ana'), 'nomes de usuário não ficam visíveis');
  for (const [u, s] of [['ana', 'senha-da-ana-123'], ['  ANA ', 'senha-da-ana-123'], ['beto', 'senha-do-beto-456']]) {
    assert.deepEqual(await cofre.abrirBase(await cofre.abrirChave(usuarios, u, s), cifrada), BASE);
  }
  for (const [u, s] of [['ana', 'senha-do-beto-456'], ['ana', ''], ['carla', 'senha-da-ana-123'], ['beto', 'Senha-do-beto-456']]) {
    await assert.rejects(cofre.abrirChave(usuarios, u, s), /LOGIN/);
  }
  await assert.rejects(cofre.abrirBase(cofre.novaChave(), cifrada), /CHAVE/);
  const adulterada = Uint8Array.from(cifrada); adulterada[40] ^= 1;
  await assert.rejects(cofre.abrirBase(chave, adulterada), /CHAVE/);
});
