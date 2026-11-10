'use strict';
// Testes da versão web: motor igual ao do desktop e cofre (cifra/login). node --test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarMotor } = require('../src/mc-core.cjs');
const { criarMotorWeb, MAPA_NCM_MC } = require('../web/motor.js');
const cofre = require('../web/cofre.js');

// Dados fictícios, só para teste.
const ITENS = [
  { Code: 'AAAAAAAAAAAA   ', MercosulNomenclature: '6006.21.00', Description: 'MALHA ALGODÃO CRU ' },
  { Code: 'BBBBBBBBBBBB', MercosulNomenclature: '60063420  ', Description: 'MALHA AÇÃO TINTA' },
  { Code: 'CCCCCCCCCCCC', MercosulNomenclature: '', Description: 'SEM NCM' },
  { Code: 'DDDDDDDDDDDD', MercosulNomenclature: '99999999', Description: 'NCM SEM REGRA' },
  { Code: 'AAAABBBBCCCC', MercosulNomenclature: '60069000', Description: 'MALHA' },
];
const BASE = { v: 1, geradoEm: '2026-01-02T03:04:05.000Z', produtos: ITENS.map((i) => [i.Code.trim(), i.Description.trim(), i.MercosulNomenclature.trim()]) };

test('motor web devolve o mesmo que o motor do desktop', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcw-'));
  const cache = path.join(dir, 'produtos_cache.json');
  fs.writeFileSync(cache, JSON.stringify(ITENS));
  const desktop = criarMotor({ cacheFile: cache });
  desktop.carregarCacheArquivo();
  const web = criarMotorWeb(BASE);
  const semTempo = (r) => { const c = { ...r }; delete c.tempo_busca; return c; };
  for (const c of ['AAAAAAAAAAAA', ' bbbbbbbbbbbb', 'CCCCCCCCCCCC', 'DDDDDDDDDDDD', 'AAAABBBBCCCC', 'ZZZZZZZZZZZZ', 'CURTO', '']) {
    assert.deepEqual(web.buscarMc(c), semTempo(desktop.buscarMc(c)), 'buscarMc ' + c);
  }
  for (const t of ['malha', 'MALHA', 'acao', 'ção', 'aaaa', 'bbbb', 'sem', 'x-nada', ' ', 'AAAABBBBCCCC']) {
    assert.deepEqual(web.buscaInteligente(t), desktop.buscaInteligente(t), 'buscaInteligente ' + t);
  }
  assert.equal(web.status().produtos_12_digitos, desktop.status().produtos_12_digitos);
  assert.deepEqual(MAPA_NCM_MC, require('../src/mc-core.cjs').MAPA_NCM_MC, 'tabela NCM->MC diferente entre web e desktop');
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
    const k = await cofre.abrirChave(usuarios, u, s);
    assert.deepEqual(await cofre.abrirBase(k, cifrada), BASE);
  }
  for (const [u, s] of [['ana', 'senha-do-beto-456'], ['ana', ''], ['carla', 'senha-da-ana-123'], ['beto', 'Senha-do-beto-456']]) {
    await assert.rejects(cofre.abrirChave(usuarios, u, s), /LOGIN/);
  }
  await assert.rejects(cofre.abrirBase(cofre.novaChave(), cifrada), /CHAVE/); // chave errada
  const adulterada = Uint8Array.from(cifrada); adulterada[40] ^= 1;
  await assert.rejects(cofre.abrirBase(chave, adulterada), /CHAVE/);         // arquivo alterado
});
