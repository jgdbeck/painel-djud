# Painel DJUD no GitLab (codigos.ufsc.br)

Arquivos para publicar o painel no GitLab Pages do projeto
`inteligencia_dados/ministerios-da-saude/djud/ciencia`, alimentado pelas issues de lá.

No repositório do GitLab a estrutura fica:

```
.gitlab-ci.yml              <- este gitlab/.gitlab-ci.yml
painel/index.html, app.css, config.js, data.js, app.js   <- os mesmos da raiz deste repositório
painel/exportar_gitlab.py   <- este gitlab/exportar_gitlab.py
```

O job `pages` copia o painel para `public/`, roda o exportador (que gera `gitlab-data.json` e
`timeline-data.json` e liga `ISSUES_JSON` no `config.js` publicado) e o GitLab Pages publica.
O `config.js` é o mesmo do GitHub: quem troca a fonte das issues é o exportador, no pipeline.

Pré-requisitos no projeto: CI/CD ligado, variável `GITLAB_TOKEN` (token de projeto `read_api`,
mascarada e protegida) e um agendamento em Build → Pipeline schedules (a cada 20 min).

Teste local (só leitura; precisa de um token `read_api` na variável GITLAB_TOKEN):

```bash
mkdir -p /tmp/site && cp index.html app.css config.js data.js app.js /tmp/site/
python3 gitlab/exportar_gitlab.py /tmp/site && python3 -m http.server 8000 -d /tmp/site
```
