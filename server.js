require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const OpenAI = require('openai');
const { OAuth2Client } = require('google-auth-library');
const cookieSession = require('cookie-session');
const path = require('path');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
// Limite maior para permitir imagens enviadas pelo chat. O servidor valida tamanho e tipo abaixo.
app.use(express.json({ limit: '20mb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));

const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  if (isProduction) throw new Error('Defina SESSION_SECRET com pelo menos 32 caracteres no Render.');
  console.warn('ATENÇÃO: defina SESSION_SECRET com pelo menos 32 caracteres antes de publicar.');
}
app.use(cookieSession({
  name: 'axtralgpt_session',
  keys: [sessionSecret || 'development-only-change-this-secret-32chars'],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax'
}));

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'AxtralGPT', openaiConfigured: Boolean(openai), googleLoginConfigured: Boolean(googleClient) }));
app.get('/api/config', (_req, res) => res.json({ googleClientId }));
app.get('/api/me', (req, res) => res.json({ user: req.session?.user || null }));

app.post('/api/auth/google', async (req, res) => {
  try {
    const credential = req.body?.credential;
    if (!googleClient || !googleClientId) return res.status(503).json({ error: 'Login Google ainda não foi configurado no servidor.' });
    if (typeof credential !== 'string' || credential.length > 10000) return res.status(400).json({ error: 'Credencial Google inválida.' });
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified) return res.status(401).json({ error: 'A conta Google não possui e-mail verificado.' });
    req.session.user = { sub: payload.sub, name: payload.name || payload.email, email: payload.email, picture: payload.picture || '' };
    res.json({ user: req.session.user });
  } catch (err) {
    console.error('Google login error:', err.message);
    res.status(401).json({ error: 'Não foi possível validar sua conta Google. Tente entrar novamente.' });
  }
});
app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

app.post('/api/chat', async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ error: 'Entre com sua conta Google para usar o AxtralGPT.' });
    const { messages, search } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30) return res.status(400).json({ error: 'Envie uma conversa válida.' });
    const clean = messages.map(m => ({
      role: m?.role,
      content: typeof m?.content === 'string' ? m.content.slice(0, 18000) : '',
      images: Array.isArray(m?.images) ? m.images : []
    })).filter(m => ['user', 'assistant'].includes(m.role) && (m.content.trim() || m.images.length));
    if (!clean.some(m => m.role === 'user')) return res.status(400).json({ error: 'Escreva uma mensagem primeiro.' });
    if (!openai) return res.status(503).json({ error: 'OPENAI_API_KEY não configurada no Render.' });

    let totalImageChars = 0;
    const input = clean.slice(-16).map(m => {
      const content = [];
      if (m.content.trim()) content.push({ type: 'input_text', text: m.content });
      if (m.images.length > 4) throw new Error('Envie no máximo 4 imagens por mensagem.');
      for (const image of m.images) {
        if (typeof image !== 'string' || !/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image)) {
          throw new Error('Uma das imagens está em formato inválido. Use PNG, JPG, WEBP ou GIF.');
        }
        totalImageChars += image.length;
        if (totalImageChars > 14_000_000) throw new Error('As imagens ficaram muito grandes. Envie imagens menores.');
        content.push({ type: 'input_image', image_url: image });
      }
      return { role: m.role, content: content.length === 1 && content[0].type === 'input_text' ? content[0].text : content };
    });

    const instructions = `Você é AxtralGPT, um assistente de IA que responde em português brasileiro. Você é muito bom em programação e especialmente em Minecraft: Skript, plugins Java para Paper, Spigot e Bukkit, configuração de servidores, HTML, CSS, JavaScript e Python. Quando o usuário pedir um Skript ou plugin, entregue uma solução completa quando possível: liste os arquivos, forneça o código integral de cada arquivo, indique dependências, versões compatíveis e instalação. Para projetos com vários arquivos, separe cada arquivo em seu próprio bloco de código e escreva o nome/caminho do arquivo antes do bloco. Não invente APIs ou sintaxe; quando houver incerteza, diga claramente. Não afirme que compilou, executou ou testou código se não fez isso. Para pedidos de código, priorize respostas práticas e completas, prontas para copiar. Você também pode analisar imagens enviadas pelo usuário, como prints de erros, configurações e construções do Minecraft. Se a pesquisa na internet estiver ativada, use a ferramenta web_search e cite links/fontes relevantes.`;
    const options = { model: MODEL, instructions, input };
    if (search) options.tools = [{ type: 'web_search' }];
    const response = await openai.responses.create(options);
    res.json({ answer: response.output_text || 'Não consegui gerar uma resposta. Tente novamente.', provider: 'OpenAI' });
  } catch (err) {
    if (err.message && /imagem|Envie no máximo|As imagens/.test(err.message)) return res.status(400).json({ error: err.message });
    console.error('AxtralGPT API error:', err.message);
    res.status(500).json({ error: 'Não consegui consultar a OpenAI. Confira a chave, o modelo, o saldo e os limites da API.' });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`AxtralGPT online na porta ${port}`));
