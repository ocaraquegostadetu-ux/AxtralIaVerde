# AxtralGPT

Projeto com frontend em um único `index.html` na raiz, backend Express, OpenAI Responses API, pesquisa web opcional, análise de imagens e login Google opcional.

## Rodar localmente

1. `npm install`
2. Copie `.env.example` para `.env` e preencha as variáveis.
3. `npm start`
4. Abra `http://localhost:3000`.

## Render

- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`

Variáveis: `OPENAI_API_KEY` (obrigatória), `OPENAI_MODEL` (opcional, padrão `gpt-5-mini`), `SESSION_SECRET` (obrigatória em produção, pelo menos 32 caracteres), `GOOGLE_CLIENT_ID` (opcional para login Google) e `NODE_ENV=production`.

Configure o OAuth Client ID do Google com o domínio do Render como origem JavaScript autorizada e configure a tela de consentimento no Google Cloud.

## Recursos

- Chat em português e pesquisa web opcional pela ferramenta `web_search`.
- Análise de imagens PNG/JPG/WEBP/GIF anexadas pelo botão `+` (até 4 por mensagem; o navegador reduz imagens antes de enviar).
- Cronômetro e mensagens de andamento enquanto a IA responde.
- Botões para baixar cada bloco de código gerado e copiar o código.
- Histórico local no navegador.

## Segurança e limitações

Nunca coloque chaves de API no HTML ou no GitHub. Configure-as como variáveis privadas no Render. O login Google é opcional. O histórico fica no navegador e não sincroniza entre dispositivos. A geração de arquivos baixa os blocos de código da resposta; não compila nem testa plugins automaticamente.
