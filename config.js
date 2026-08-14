/* Painel DJUD — configuração.
   Este é o único arquivo que muda entre desenvolvimento e produção.

   SHEET_API vazio  → MODO DEMONSTRAÇÃO: os dados ficam só neste navegador
                      (localStorage) e cada pessoa vê a sua cópia.
   SHEET_API com a  → MODO CONECTADO: os dados ficam numa Planilha Google e são
   URL do Apps Script  os mesmos para todo mundo. Leitura é pública; para editar
                       é preciso a senha. Veja o README.md para publicar a API. */
const CONFIG = {
  SHEET_API: ""   // ex.: "https://script.google.com/macros/s/AKfy.../exec"
};
