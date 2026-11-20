# MD Renderer to Browser

Extensão do VS Code que abre arquivos Markdown renderizados no navegador, numa página limpa, sem a interface do editor em volta.

## Uso

Clique com o botão direito num `.md` e escolha **Open in Browser**. O comando aparece em:

- menu de contexto do Explorer
- menu de contexto do editor e da aba do arquivo
- ícone de globo na barra de título do editor
- Command Palette: `Markdown: Open in Browser`

Na página aberta:

- links relativos para outros `.md` abrem renderizados na mesma aba, e o botão voltar do navegador funciona
- imagens e outros arquivos com caminho relativo carregam normalmente
- links externos abrem em nova aba
- ao salvar o arquivo no VS Code, a página atualiza sozinha e mantém a posição da rolagem
- alterações ainda não salvas no editor aparecem ao recarregar a página (F5)

## Como funciona

Ao rodar o comando pela primeira vez, a extensão sobe um servidor HTTP em `127.0.0.1`, numa porta livre, e abre o navegador padrão nele. O servidor para quando o VS Code fecha.

A URL leva um token aleatório gerado a cada sessão. Requisições sem esse token recebem 403, então outros sites abertos no navegador não conseguem ler arquivos pelo servidor.

O caminho do arquivo vai na própria URL (`C:\docs\a.md` vira `/<token>/C/docs/a.md`). Assim o navegador resolve links relativos sozinho, sem tratamento especial.

Cada página aberta mantém uma conexão de Server-Sent Events com o servidor. Quando um arquivo é salvo no VS Code, o servidor avisa todas as abas. A aba que mostra aquele arquivo busca o HTML de novo e troca só o conteúdo, sem recarregar a página inteira.

A renderização usa o parser e o CSS do `viewer.html`. A extensão lê o código entre os marcadores `//__MD_START__` e `//__MD_END__` e o bloco `<style>`, a cada página servida. Mudanças no `viewer.html` valem para a extensão sem outro passo.

## viewer.html sozinho

O `viewer.html` também funciona sem a extensão. Abra-o no navegador e arraste um `.md` para a página. Para seguir links entre arquivos, arraste-os juntos ou use **open project folder** (só em navegadores Chromium).

## Desenvolvimento

A extensão é escrita em TypeScript e compilada com `tsc` para `out/`. Não há dependências em tempo de execução, só ferramentas de desenvolvimento.

| Arquivo | Conteúdo |
| --- | --- |
| `src/extension.ts` | comando, servidor HTTP e montagem da página |
| `viewer.html` | parser de Markdown e CSS, e o visualizador standalone |
| `package.json` | manifesto da extensão: comandos e menus |
| `tsconfig.json` | configuração do compilador |

O parser dentro do `viewer.html` continua em JavaScript, porque também roda direto no navegador.

```sh
npm install         # uma vez
npm run compile     # compila para out/
npm run watch       # recompila a cada alteração
```

Para testar, abra a pasta no VS Code e aperte F5. Isso compila e abre uma janela separada com a extensão carregada.

Para empacotar e instalar (o empacotamento compila antes):

```sh
npm run package
code --install-extension md-renderer-to-browser-0.1.0.vsix
```

Depois de instalar, rode **Developer: Reload Window** para carregar a versão nova.

## Limitações

- O parser de Markdown é simples: cobre títulos, listas (inclusive de tarefas), tabelas, blocos de código, citações, links e imagens. Não há realce de sintaxe, notas de rodapé nem HTML embutido.
- Os títulos não ganham `id`, então links para âncoras (`#secao`) não rolam a página.
- A atualização automática só acontece com saves feitos no VS Code. Alterações feitas por outro programa exigem F5.
- Se o VS Code fechar, a página para de atualizar. Ao abrir de novo, o servidor usa outra porta e outro token, então é preciso rodar **Open in Browser** outra vez.
- Só funciona com arquivos locais (esquema `file`), não em workspaces remotos.
