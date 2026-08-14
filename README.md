# Painel DJUD

Painel de priorização e acompanhamento das demandas de dados do DJUD (judicialização de medicamentos). Site estático, sem build e sem dependências: são cinco arquivos que o navegador abre direto.

## Os dois modos

| | Modo demonstração | Modo conectado |
|---|---|---|
| Quando | `SHEET_API` vazio em `config.js` | `SHEET_API` com a URL do Apps Script |
| Onde ficam os dados | `localStorage` do próprio navegador | Planilha Google, iguais para todo mundo |
| Quem edita | qualquer um | quem tem a senha da equipe |
| Para que serve | desenvolver e testar offline | uso real |

## Rodar localmente

```bash
python3 -m http.server 8000    # depois abra http://localhost:8000
```

Abrir o `index.html` direto pelo `file://` também funciona — os scripts são clássicos, sem `type="module"`, exatamente para isso continuar valendo.

## Testes

```bash
cd test && npm install && npm test
```

Carrega o painel num DOM de mentira e exercita os dois modos: as três telas, criar/editar/excluir/filtrar, persistência entre recargas e, no modo conectado, o login por senha, o somente-leitura, os rollbacks e o formato das chamadas. A planilha é simulada, então o teste não toca no Google, não precisa de senha e roda offline.

O Node é usado **só aqui**. O painel continua sem build e sem dependências: `node_modules` fica dentro de `test/` e não vai para o GitHub Pages.

## Ligar a persistência na planilha

Faça uma vez. Leva uns 10 minutos.

**1. Criar a planilha e o script**

1. Crie uma Planilha Google nova (o nome não importa).
2. Nela, vá em **Extensões → Apps Script**. Isso cria um script já vinculado à planilha.
3. Apague o conteúdo do editor e cole o de [`apps-script/Codigo.gs`](apps-script/Codigo.gs). Salve.

**2. Definir a senha de edição**

No editor do Apps Script: **⚙ Configurações do projeto → Propriedades do script → Adicionar propriedade**.

- Propriedade: `SENHA`
- Valor: uma frase longa e aleatória

Use algo com 20 caracteres ou mais. O endereço fica público na internet, então qualquer pessoa pode tentar adivinhar a senha — o comprimento é o que torna isso inviável na prática. Não coloque essa senha em nenhum arquivo do repositório.

**3. Preparar a aba**

No editor, selecione a função `setup` e clique em **Executar**. Ele vai pedir autorização na primeira vez (é o seu próprio script acessando a sua planilha). Isso cria a aba `demandas` com o cabeçalho certo.

**4. Publicar**

**Implantar → Nova implantação → Tipo: App da Web**:

- Executar como: **Eu**
- Quem pode acessar: **Qualquer pessoa**

O segundo item precisa ser esse mesmo para o painel conseguir ler sem login. Copie a URL que termina em `/exec`.

**5. Apontar o painel para a API**

Em [`config.js`](config.js), cole a URL:

```js
const CONFIG = {
  SHEET_API: "https://script.google.com/macros/s/AKfy…/exec"
};
```

**6. Levar os dados atuais para a planilha**

Com o painel ainda em modo demonstração, clique em **Exportar JSON**. Depois ligue a `SHEET_API`, recarregue, entre com a senha e use **Importar** com esse arquivo — as demandas vão todas de uma vez para a planilha.

### Ao alterar o `Codigo.gs` depois

**Implantar → Gerenciar implantações → ✎ (editar) → Versão: Nova versão → Implantar.**

Não crie uma implantação nova: ela ganha outra URL e o painel para de funcionar até você atualizar o `config.js`. Esta é a pegadinha que mais custa tempo no Apps Script.

## Publicar no GitHub Pages

**Settings → Pages → Source: Deploy from a branch → `main` / `(root)`.** Em um ou dois minutos o painel fica em `https://<usuario>.github.io/<repositorio>/`.

Lembre que o repositório é público: só o que está nele é público. A senha vive nas propriedades do script e os dados vivem na planilha — nenhum dos dois passa pelo Git.

## Como a API funciona

Uma rota só, com a operação no campo `action`:

| Ação | Método | Corpo | Precisa de senha |
|---|---|---|---|
| `list` | GET `?action=list` | — | não |
| `login` | POST | `{action, pass}` | sim |
| `create` | POST | `{action, pass, demanda}` | sim |
| `update` | POST | `{action, pass, demanda}` | sim |
| `delete` | POST | `{action, pass, id}` | sim |
| `replaceAll` | POST | `{action, pass, demandas}` | sim |

Duas restrições do Apps Script explicam esse desenho, e mexer nelas quebra tudo:

- **Não dá para responder a um preflight CORS.** Por isso todo POST é uma *simple request*: `Content-Type: text/plain;charset=utf-8` e nenhum cabeçalho extra. A senha vai no corpo justamente porque um cabeçalho `Authorization` dispararia o preflight.
- **Não dá para escolher o status HTTP.** A resposta é sempre 200 e o que valeu está no corpo: `{ok:true, data:…}` ou `{ok:false, error:…, code:…}`. `code:"auth"` faz o painel pedir a senha de novo.

## O que fica guardado no navegador

| Chave | Conteúdo |
|---|---|
| `djud_demandas_v3` | as demandas do modo demonstração |
| `djud_pass` | a senha de edição, para não digitar toda vez |

No modo conectado o `djud_demandas_v3` é ignorado — quem manda é a planilha.

## Limitações conhecidas

- **Sem trilha de auditoria.** Com senha única não há como saber quem alterou o quê. O histórico de versões da planilha (Arquivo → Histórico de versões) é o que mais se aproxima disso, e também serve de backup.
- **Latência.** O Apps Script leva de 1 a 3 segundos por operação; salvar não é instantâneo como no modo demonstração.
- **Sem edição simultânea.** As escritas são serializadas por um lock, então nada corrompe, mas duas pessoas editando a mesma demanda ao mesmo tempo: vale a última que salvar.
