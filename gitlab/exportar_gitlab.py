"""Gera os dados do painel a partir das issues do GitLab (roda no pipeline do projeto).

Uso:  python3 exportar_gitlab.py <pasta_de_saida>

Escreve na pasta:
  gitlab-data.json   -> issues no formato que o Roadmap/Início/Acompanhamento já leem
                        (mesmos campos da API do GitHub + `column`, a coluna do board)
  timeline-data.json -> entregáveis com data de início e prazo, para a Linha do tempo
E, se a pasta tiver um config.js (copiado do painel), liga nele a leitura do GitLab
(ISSUES_JSON etc.), para o config.js do repositório continuar um só.

Variáveis de ambiente (o GitLab CI preenche as CI_*):
  GITLAB_TOKEN        token só leitura (read_api) — variável mascarada do projeto
  CI_API_V4_URL       ex.: https://codigos.ufsc.br/api/v4
  CI_API_GRAPHQL_URL  ex.: https://codigos.ufsc.br/api/graphql
  CI_PROJECT_ID       id numérico do projeto
  CI_PROJECT_PATH     caminho do projeto (para a consulta GraphQL das datas)
  CI_PROJECT_URL      endereço do projeto (para o botão "Abrir no GitLab")
Só usa a biblioteca padrão do Python: nada a instalar.
"""
import json, os, re, sys, urllib.parse, urllib.request

API = os.environ.get("CI_API_V4_URL", "https://codigos.ufsc.br/api/v4").rstrip("/")
GRAPHQL = os.environ.get("CI_API_GRAPHQL_URL", API.replace("/api/v4", "/api/graphql"))
PROJECT_ID = os.environ.get("CI_PROJECT_ID", "2788")
PROJECT_PATH = os.environ.get("CI_PROJECT_PATH", "inteligencia_dados/ministerios-da-saude/djud/ciencia")
PROJECT_URL = os.environ.get("CI_PROJECT_URL", "https://codigos.ufsc.br/" + PROJECT_PATH)
TOKEN = os.environ.get("GITLAB_TOKEN", "")

# label do board -> coluna do painel (fechada vai sempre para "Closed")
COLUNAS = {
    "status::backlog do projeto": "backlog do projeto",
    "status::backlog de sprint": "backlog de sprint",
    "status::em andamento": "em andamento",
    "status::em validação": "em validação",
    "status::impedida": "impedida",
}
PRIORIDADE = {"prioridade::p0": "Prioridade 1", "prioridade::p1": "Prioridade 2", "prioridade::p2": "Prioridade 3"}
COMPLEXIDADE = {1: "Baixa", 2: "Média", 3: "Alta", 4: "Alta", 5: "Muito alta"}
# rótulos do painel que só existem no texto das issues migradas ("Labels no GitHub: ...")
ORIGINAIS = re.compile(r"^(Meta \d.*|Condicional \(acesso/SEI\)|Estrutural \(sem prioridade\)|Prioridade A definir)$")


def pedir(url, data=None):
    headers = {"Content-Type": "application/json"}
    if TOKEN:
        headers["PRIVATE-TOKEN"] = TOKEN
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data else None, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def todas(caminho):
    itens, pagina = [], 1
    while True:
        sep = "&" if "?" in caminho else "?"
        lote = pedir(f"{API}{caminho}{sep}per_page=100&page={pagina}")
        itens += lote
        if len(lote) < 100:
            return itens
        pagina += 1


def labels_originais(descricao):
    m = re.search(r"^> Labels no GitHub: (.+)$", descricao or "", re.M)
    if not m:
        return []
    return [x.strip() for x in m.group(1).split(", ") if ORIGINAIS.match(x.strip())]


def sem_cabecalho(descricao):
    """Tira o bloco "> Migrado do GitHub..." do topo; o painel mostra o texto original."""
    linhas = (descricao or "").split("\n")
    while linhas and (linhas[0].startswith(">") or not linhas[0].strip()):
        linhas.pop(0)
    return "\n".join(linhas)


def coluna(issue):
    if issue["state"] == "closed":
        return "Closed"
    return next((COLUNAS[l] for l in issue["labels"] if l in COLUNAS), "backlog do projeto")


def converter(issue):
    nomes = list(issue["labels"])
    prio = [PRIORIDADE[l] for l in issue["labels"] if l in PRIORIDADE]
    nomes += prio[:1]
    if issue.get("weight") in COMPLEXIDADE:
        nomes.append("Complexidade " + COMPLEXIDADE[issue["weight"]])
    nomes += [l for l in labels_originais(issue.get("description")) if not (prio and l == "Prioridade A definir")]
    return {
        "number": issue["iid"],
        "title": issue["title"],
        "body": sem_cabecalho(issue.get("description")),
        "state": "open" if issue["state"] == "opened" else "closed",
        "html_url": issue["web_url"],
        "labels": [{"name": n} for n in nomes],
        "assignees": [{"login": a["name"]} for a in issue.get("assignees") or []],
        "updated_at": issue["updated_at"],
        "comments": issue.get("user_notes_count", 0),
        "column": coluna(issue),
    }


def datas():
    """iid -> (início, prazo). A data de início só existe na API GraphQL."""
    consulta = """query($p: ID!, $depois: String) { project(fullPath: $p) { workItems(first: 100, after: $depois) {
      pageInfo { hasNextPage endCursor }
      nodes { iid widgets { ... on WorkItemWidgetStartAndDueDate { startDate dueDate } } } } } }"""
    out, depois = {}, None
    while True:
        r = pedir(GRAPHQL, {"query": consulta, "variables": {"p": PROJECT_PATH, "depois": depois}})
        if r.get("errors"):
            raise RuntimeError(f"GraphQL: {r['errors']}")
        bloco = r["data"]["project"]["workItems"]
        for n in bloco["nodes"]:
            w = next((w for w in n["widgets"] if "dueDate" in w), {})
            out[int(n["iid"])] = (w.get("startDate"), w.get("dueDate"))
        if not bloco["pageInfo"]["hasNextPage"]:
            return out
        depois = bloco["pageInfo"]["endCursor"]


MIGRADO = re.compile(r"^> \*\*Comentário migrado do GitHub\*\* — `@[^`]+` em (\d\d)/(\d\d)/(\d{4})[^\n]*\n+")


def notas(iid):
    """Os 15 comentários mais recentes como "[dd/mm/aaaa] texto" (mesmo formato do GitHub)."""
    linhas = []
    for n in todas(f"/projects/{PROJECT_ID}/issues/{iid}/notes?sort=asc&order_by=created_at"):
        if n.get("system"):
            continue
        corpo = n["body"]
        m = MIGRADO.match(corpo)
        if m:  # comentário migrado: usa a data original, não a da migração
            dia, mes, ano = m.groups()
            corpo = corpo[m.end():]
        else:
            ano, mes, dia = n["created_at"][:10].split("-")
        linhas.append(f"[{dia}/{mes}/{ano}] " + re.sub(r"\s+", " ", corpo).strip()[:200])
    return "\n".join(linhas[-15:])


def ligar_config(caminho):
    with open(caminho, encoding="utf-8") as f:
        texto = f.read()
    for chave, valor in (("ISSUES_JSON", "gitlab-data.json"), ("GITLAB_PROJECT", PROJECT_PATH),
                         ("GITLAB_BOARD_URL", PROJECT_URL + "/-/boards")):
        texto, n = re.subn(rf'{chave}: "[^"]*"', f"{chave}: {json.dumps(valor)}", texto)
        if n != 1:
            raise RuntimeError(f"config.js sem a chave {chave}")
    with open(caminho, "w", encoding="utf-8") as f:
        f.write(texto)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    saida = sys.argv[1]
    os.makedirs(saida, exist_ok=True)
    if not TOKEN and os.environ.get("CI"):
        sys.exit("GITLAB_TOKEN não definido: crie a variável mascarada em Configurações → CI/CD → Variáveis.")

    brutas = todas(f"/projects/{PROJECT_ID}/issues?state=all&order_by=created_at&sort=asc")
    issues = [converter(i) for i in brutas]
    with open(os.path.join(saida, "gitlab-data.json"), "w", encoding="utf-8") as f:
        json.dump(issues, f, ensure_ascii=False, indent=1)

    por_iid = {i["number"]: i for i in issues}
    linha = []
    for iid, (inicio, prazo) in datas().items():
        if not (inicio and prazo and iid in por_iid):
            continue
        reg = {"uid": str(iid), "entregavel": por_iid[iid]["title"], "inicio": inicio, "termino": prazo,
               "status": por_iid[iid]["column"], "url": ""}
        if por_iid[iid]["comments"]:
            reg["notas"] = notas(iid)
        linha.append(reg)
    linha.sort(key=lambda r: r["inicio"])
    with open(os.path.join(saida, "timeline-data.json"), "w", encoding="utf-8") as f:
        json.dump(linha, f, ensure_ascii=False, indent=2)

    config = os.path.join(saida, "config.js")
    if os.path.exists(config):
        ligar_config(config)

    print(f"{len(issues)} issues exportadas; {len(linha)} com início e prazo na Linha do tempo.")


if __name__ == "__main__":
    main()
