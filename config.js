/* Painel DJUD — configuração.
   Este é o ÚNICO arquivo que você precisa mexer.

   >>> PARA LIGAR A PLANILHA GOOGLE (modo conectado): <<<
   Cole entre as aspas de SHEET_API a URL do Apps Script que termina em /exec.
   (peça essa URL ao colega que publicou a planilha, ou gere a sua seguindo o README).

   SHEET_API vazio  -> MODO DEMONSTRAÇÃO: dados só neste navegador (cada um vê a sua cópia).
   SHEET_API com a  -> MODO CONECTADO: dados numa Planilha Google, iguais para todos.
   URL do /exec        Leitura é pública; para editar é preciso a senha da equipe. */
const CONFIG = {
  SHEET_API: ""   // ex.: "https://script.google.com/macros/s/AKfy.../exec"
};
