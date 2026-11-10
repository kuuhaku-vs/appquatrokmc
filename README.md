# Busca de MC — Grupo Quatro K

Aplicativo de desktop (Windows) para consultar o **código MC** de um produto a partir do código de 12 caracteres, com busca inteligente por trecho de código ou de descrição. Extraído do módulo "Busca de MC" do NØVA; o motor roda dentro do próprio app, **sem Python**.

## Baixar e usar

1. Abra a página **[Releases](../../releases/latest)** e baixe `BuscaMC-x.y.z-win-x64.zip`.
2. Extraia a pasta para um local seu (Área de Trabalho, Documentos…). Não execute de dentro do ZIP.
3. Abra `BuscaMC.exe`.

Não precisa instalar nem de permissão de administrador. Na primeira abertura o app cria o atalho **"Busca de MC — Quatro K"** na Área de Trabalho do usuário.

> O executável não tem assinatura digital. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**.

### Primeira configuração

Este repositório **não contém** a senha do Protheus nem a base de produtos. Depois de abrir o app uma vez, escolha uma das opções:

- **Já usava o app em outra pasta:** copie a pasta `dados` antiga (com `config.json` e `produtos_cache.json`) para dentro da pasta nova.
- **Instalação do zero:** clique em **Pasta de dados**, abra `config.json` e preencha conforme [`config.example.json`](config.example.json):

  ```json
  {
    "protheus": { "url": "http://SERVIDOR:PORTA", "usuario": "…", "senha": "…" },
    "atualizarMinutos": 30
  }
  ```

  Reabra o app (ou clique em **Atualizar base**) com o computador na rede da empresa. A base é baixada do Protheus e fica salva em `dados\produtos_cache.json`; depois disso a consulta funciona mesmo sem rede.

`dados\config.json` guarda a senha em texto simples: não compartilhe essa pasta.

## Como funciona

- Só entram na base os produtos com código de **exatamente 12 caracteres**.
- O MC vem de uma tabela fixa **Pos.IPI/NCM → MC** (`MAPA_NCM_MC` em [`src/mc-core.cjs`](src/mc-core.cjs)).
- A base local é carregada primeiro; a atualização pelo Protheus acontece em segundo plano ao abrir e a cada 30 minutos.
- Ao encontrar o MC, ele é copiado automaticamente e o código digitado fica selecionado, pronto para a próxima consulta.
- Qualquer texto que não seja um código de 12 caracteres faz a busca inteligente (sem acentos, por código ou descrição).

| Arquivo | Função |
| --- | --- |
| `src/main.cjs` | Janela, atalho, pasta de dados e comunicação com a tela |
| `src/mc-core.cjs` | Motor: cache, regras NCM → MC, busca inteligente, consulta ao Protheus |
| `src/index.html` | Tela |
| `dados/` (ao lado do `.exe`) | `config.json`, `produtos_cache.json`, `busca_mc.log` |

## Desenvolvimento

```bash
npm install
npm test        # testes do motor (não precisam de Electron nem de rede)
npm start       # abre o app em modo desenvolvimento (dados em src/dados)
npm run dist    # gera dist/BuscaMC-<versão>-win-x64.zip (rodar no Windows)
```

## Publicar uma nova versão

1. Atualize `"version"` em `package.json`.
2. Crie e envie a tag correspondente:

   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```

O GitHub Actions ([`release.yml`](.github/workflows/release.yml)) roda os testes, empacota o app no Windows e publica o ZIP em Releases. Também dá para gerar o ZIP sem publicar em **Actions → Gerar aplicativo → Run workflow**.
