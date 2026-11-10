# Busca de MC — Grupo Quatro K

Site para consultar o **código MC** de um produto a partir do código de 12 caracteres, com busca inteligente por trecho de código ou de descrição.

**Abrir: https://kuuhaku-vs.github.io/appquatrokmc/**

Entre com usuário e senha e consulte. Funciona em computador e celular. No Chrome ou Edge dá para **instalar como aplicativo** (ícone "Instalar" na barra de endereço): ganha janela e atalho próprios e funciona sem internet depois do primeiro acesso.

## Como funciona

- Só entram na base os produtos com código de **exatamente 12 caracteres**.
- O MC vem de uma tabela fixa **Pos.IPI/NCM → MC** (`MAPA_NCM_MC` em [`motor.js`](motor.js)).
- Ao encontrar o MC, ele é copiado automaticamente e o código digitado fica selecionado, pronto para a próxima consulta.
- A base de produtos (`dados/base.bin`) é publicada **cifrada** (AES-256) e só abre com usuário e senha. Não há servidor: a senha nunca sai do navegador.
- O site **não consulta o Protheus**: um site público não alcança o servidor da rede interna. Ele usa uma cópia da base, atualizada como descrito abaixo.

| Arquivo | Função |
| --- | --- |
| `index.html` | Tela |
| `app.js` | Login e ligação da tela com o motor |
| `motor.js` | Regras da busca |
| `cofre.js` | Cifra da base e verificação de usuário/senha |
| `dados/` | Base cifrada (`base.bin`) e usuários (`usuarios.json`) |
| `sw.js`, `manifest.webmanifest` | Instalação como aplicativo e uso offline |
| `tools/base.cjs` | Administração da base e dos usuários |

## Usuários e atualização da base

Precisa de [Node.js](https://nodejs.org) 20+ e de uma cópia deste repositório.

```bash
node tools/base.cjs usuario                                 # cria usuário ou troca senha (pede um login existente)
node tools/base.cjs remover                                 # remove usuário
node tools/base.cjs atualizar caminho/produtos_cache.json   # troca os produtos, mantendo usuários
```

`produtos_cache.json` é o arquivo gerado pelo app de desktop a partir do Protheus. Depois de rodar, envie a pasta `dados/` para a branch `main`; o GitHub Pages republica o site em cerca de um minuto.

Use senhas com 12 ou mais caracteres e **não reutilize a senha do Protheus**: o arquivo cifrado é público, então a proteção é tão forte quanto a senha.

`npm test` roda os testes das regras de busca e da cifra.
