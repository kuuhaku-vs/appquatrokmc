#!/usr/bin/env node
'use strict';
// Administra a base cifrada do site (web/dados/base.bin e web/dados/usuarios.json).
//
//   node tools/base.cjs criar     <produtos_cache.json>   cria a base com uma chave nova e o primeiro usuário
//   node tools/base.cjs atualizar <produtos_cache.json>   troca os produtos, mantendo usuários e senhas
//   node tools/base.cjs usuario                           cria um usuário ou troca a senha de um existente
//   node tools/base.cjs remover                           remove um usuário
//
// "atualizar", "usuario" e "remover" pedem o login de um usuário que já existe.
// Usuário e senha podem vir das variáveis MC_USUARIO / MC_SENHA (e MC_NOVO_USUARIO / MC_NOVA_SENHA).
// produtos_cache.json é o arquivo da pasta "dados" do app de desktop.
// Depois de rodar, envie web/dados/* para a branch main: o GitHub Pages republica o site.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const cofre = require('../web/cofre.js');

const DADOS = path.join(__dirname, '..', 'web', 'dados');
const ARQ_BASE = path.join(DADOS, 'base.bin');
const ARQ_USUARIOS = path.join(DADOS, 'usuarios.json');

function perguntar(texto, oculto = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) rl._writeToOutput = (s) => { if (s.includes(texto)) rl.output.write(texto); };
    rl.question(texto, (r) => { rl.close(); if (oculto) process.stdout.write('\n'); resolve(r); });
  });
}
const pedir = async (env, texto, oculto) => process.env[env] ?? perguntar(texto, oculto);

function lerProdutos(arquivo) {
  if (!arquivo) throw new Error('Informe o caminho do produtos_cache.json.');
  const itens = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const produtos = [];
  for (const it of itens) {
    const codigo = String(it.Code ?? '').trim().toUpperCase();
    if (codigo.length !== 12) continue; // o app só consulta códigos de 12 caracteres
    produtos.push([codigo, String(it.Description ?? '').trim(), String(it.MercosulNomenclature ?? '').trim()]);
  }
  if (!produtos.length) throw new Error('Nenhum produto com código de 12 caracteres em ' + arquivo);
  produtos.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { v: 1, geradoEm: fs.statSync(arquivo).mtime.toISOString(), produtos };
}

const lerUsuarios = () => JSON.parse(fs.readFileSync(ARQ_USUARIOS, 'utf8'));
function gravarUsuarios(u) {
  fs.mkdirSync(DADOS, { recursive: true });
  fs.writeFileSync(ARQ_USUARIOS, JSON.stringify(u, null, 2) + '\n');
}

async function login(usuarios) {
  const usuario = await pedir('MC_USUARIO', 'Usuário existente: ');
  const senha = await pedir('MC_SENHA', 'Senha: ', true);
  try {
    return await cofre.abrirChave(usuarios, usuario, senha);
  } catch {
    throw new Error('Usuário ou senha incorretos.');
  }
}

function validarSenha(senha) {
  if (String(senha).length < 12) {
    throw new Error('Use uma senha com pelo menos 12 caracteres: a base cifrada é pública e senha curta pode ser quebrada.');
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'criar') {
    if (fs.existsSync(ARQ_USUARIOS) && !process.env.MC_RECRIAR) {
      throw new Error('A base já existe. Use "atualizar", ou defina MC_RECRIAR=1 para recriar com chave nova (todos os usuários são apagados).');
    }
    const base = lerProdutos(arg);
    const usuario = await pedir('MC_NOVO_USUARIO', 'Primeiro usuário: ');
    const senha = await pedir('MC_NOVA_SENHA', 'Senha (mín. 12 caracteres): ', true);
    validarSenha(senha);
    const chave = cofre.novaChave();
    fs.mkdirSync(DADOS, { recursive: true });
    fs.writeFileSync(ARQ_BASE, await cofre.fecharBase(chave, base));
    gravarUsuarios({ v: 1, kdf: { nome: 'PBKDF2', hash: 'SHA-256', iteracoes: cofre.ITERACOES }, usuarios: [await cofre.entradaUsuario(chave, usuario, senha)] });
    console.log(`Base criada: ${base.produtos.length} produtos, 1 usuário.`);
  } else if (cmd === 'atualizar') {
    const base = lerProdutos(arg);
    const chave = await login(lerUsuarios());
    fs.writeFileSync(ARQ_BASE, await cofre.fecharBase(chave, base));
    console.log(`Base atualizada: ${base.produtos.length} produtos (dados de ${base.geradoEm}).`);
  } else if (cmd === 'usuario') {
    const usuarios = lerUsuarios();
    const chave = await login(usuarios);
    const usuario = await pedir('MC_NOVO_USUARIO', 'Usuário a criar/alterar: ');
    const senha = await pedir('MC_NOVA_SENHA', 'Nova senha (mín. 12 caracteres): ', true);
    validarSenha(senha);
    const entrada = await cofre.entradaUsuario(chave, usuario, senha, usuarios.kdf.iteracoes);
    usuarios.usuarios = usuarios.usuarios.filter((u) => u.id !== entrada.id).concat(entrada);
    gravarUsuarios(usuarios);
    console.log(`Usuário gravado. Total: ${usuarios.usuarios.length}.`);
  } else if (cmd === 'remover') {
    const usuarios = lerUsuarios();
    await login(usuarios);
    const id = await cofre.idUsuario(await pedir('MC_NOVO_USUARIO', 'Usuário a remover: '));
    const antes = usuarios.usuarios.length;
    usuarios.usuarios = usuarios.usuarios.filter((u) => u.id !== id);
    if (usuarios.usuarios.length === antes) throw new Error('Usuário não encontrado.');
    if (!usuarios.usuarios.length) throw new Error('Não é possível remover o último usuário.');
    gravarUsuarios(usuarios);
    console.log('Usuário removido. Atenção: quem já entrou pode ter a chave salva no navegador; para revogar de verdade, recrie a base (MC_RECRIAR=1 ... criar).');
  } else {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => { console.error('ERRO: ' + e.message); process.exit(1); });
