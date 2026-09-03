/* Painel DJUD — configuração.
   SHEET_API vazio  -> MODO DEMONSTRAÇÃO (sem login, salva só no navegador).
   SHEET_API com a  -> MODO CONECTADO (dados na planilha; edição exige senha).
   NÃO deixe a URL no comentário: ela precisa ficar DENTRO das aspas abaixo.
   GITHUB_REPO      -> "dono/repositorio" cujas issues alimentam a aba Roadmap
   (lidas direto da API pública do GitHub, sem senha; exige o repositório público). */
const CONFIG = {
  SHEET_API: "https://script.google.com/macros/s/AKfycbz3fkfT9gZY3uKa2r97rHEkuMhjoKqH3oNsavguhKaFwOhgwJVdxiD1VhJnZBPPz03U/exec",
  GITHUB_REPO: "jgdbeck/painel-djud"
};
