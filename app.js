// ═══════════════════════════════════════════════════════════════
// LEXIS AI — app.js (ES Module, Firebase via CDN + FFmpeg via CDN)
// ═══════════════════════════════════════════════════════════════

import { initializeApp, getApps, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'
import { getFirestore, collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js'

// ─── CONFIG ──────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyALU3x5WnXquu78j19ff3ZOLroHCp2u10w",
  authDomain: "advogado-e6c61.firebaseapp.com",
  projectId: "advogado-e6c61",
  storageBucket: "advogado-e6c61.firebasestorage.app",
  messagingSenderId: "235488205958",
  appId: "1:235488205958:web:730cf9a169ac3f3dce0507",
  measurementId: "G-EWD46XF6RR"
};


const CONFIG_KEY = 'lexis_config'

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') } catch { return {} }
}
function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
}
const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b'

// Modelos desativados pela Groq (retornam 404/400). Migração automática.
const GROQ_DEPRECATED = {
  'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
  'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
  'llama3-70b-8192': 'openai/gpt-oss-120b',
  'llama3-8b-8192': 'openai/gpt-oss-20b',
  'mixtral-8x7b-32768': 'openai/gpt-oss-120b',
  'gemma2-9b-it': 'openai/gpt-oss-20b',
  'qwen/qwen3-32b': 'openai/gpt-oss-120b',
  'meta-llama/llama-4-scout-17b-16e-instruct': 'openai/gpt-oss-120b',
}

function getGroqKey() {
  return loadConfig().groqApiKey?.trim() || "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"
}

function getGroqModel() {
  const m = loadConfig().groqModel
  return GROQ_DEPRECATED[m] || m || GROQ_DEFAULT_MODEL
}

// ─── ESTADO GLOBAL ────────────────────────────────────────────────

let state = {
  currentUser: null,
  currentPage: 'dashboard',
  selectedCase: null,
  cases: [],
  recordings: [],
  chatHistory: [],
  chatLoading: false,
  fbApp: null, fbAuth: null, fbDb: null, fbStorage: null,
  fbReady: false,
  mediaRecorder: null, recordingChunks: [], recordingTimer: null, recordingElapsed: 0,
  newCaseStep: 1,
  newCaseData: {},
  scriptData: null,
  reportContent: null,
  ffmpegReady: false,
  ffmpegLoading: false,
}

// ─── FIREBASE INIT ────────────────────────────────────────────────

function initFirebase() {
  try {
    const firebaseConfig = {
       apiKey: "AIzaSyALU3x5WnXquu78j19ff3ZOLroHCp2u10w",
  authDomain: "advogado-e6c61.firebaseapp.com",
  projectId: "advogado-e6c61",
  storageBucket: "advogado-e6c61.firebasestorage.app",
  messagingSenderId: "235488205958",
  appId: "1:235488205958:web:730cf9a169ac3f3dce0507",
  measurementId: "G-EWD46XF6RR"
    }

    const apps = getApps()

    state.fbApp = apps.length ? apps[0] : initializeApp(firebaseConfig)
    state.fbAuth = getAuth(state.fbApp)
    state.fbDb = getFirestore(state.fbApp)
    state.fbStorage = getStorage(state.fbApp)
    state.fbReady = true

    return true
  } catch (e) {
    console.error("Erro Firebase:", e)
    state.fbReady = false
    return false
  }
}
// ─── FFMPEG (CDN — sem Node.js) ───────────────────────────────────

let _ffmpeg = null

async function loadFFmpeg() {
  if (state.ffmpegReady && _ffmpeg) return _ffmpeg
  if (state.ffmpegLoading) {
    return new Promise(resolve => {
      const check = setInterval(() => {
        if (state.ffmpegReady || !state.ffmpegLoading) { clearInterval(check); resolve(_ffmpeg) }
      }, 200)
    })
  }

  // FFmpeg WASM requer SharedArrayBuffer + COOP/COEP headers — não disponível em mobile/local sem servidor adequado
  if (typeof SharedArrayBuffer === 'undefined') {
    console.warn('[FFmpeg] SharedArrayBuffer indisponível (mobile ou servidor sem COOP/COEP). FFmpeg desativado.')
    return null
  }

  state.ffmpegLoading = true
  try {
    const { FFmpeg } = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js')
    const { fetchFile, toBlobURL } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js')
    _ffmpeg = new FFmpeg()
    _ffmpeg.on('log', ({ message }) => console.log('[FFmpeg]', message))
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
    await _ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    _ffmpeg._fetchFile = fetchFile
    state.ffmpegReady = true
    state.ffmpegLoading = false
    console.log('[FFmpeg] Carregado com sucesso')
    return _ffmpeg
  } catch (e) {
    state.ffmpegLoading = false
    console.warn('[FFmpeg] Falha ao carregar:', e.message)
    return null
  }
}

/**
 * Converte qualquer Blob de áudio/vídeo para MP4 (H.264 + AAC) usando FFmpeg WASM.
 * Retorna o Blob convertido; se falhar, devolve o original.
 */
async function convertToMp4(blob, onProgress) {
  try {
    onProgress?.({ stage: 'Carregando FFmpeg…', pct: 5 })
    const ffmpeg = await loadFFmpeg()
    if (!ffmpeg) throw new Error('FFmpeg indisponível')

    const inputName = 'input.' + (blob.type.includes('webm') ? 'webm' : blob.type.includes('ogg') ? 'ogg' : 'mp4')
    const outputName = 'output.mp4'

    onProgress?.({ stage: 'Preparando arquivo…', pct: 15 })
    ffmpeg.writeFile(inputName, await ffmpeg._fetchFile(blob))

    onProgress?.({ stage: 'Convertendo com FFmpeg…', pct: 30 })
    // Converte para MP4 com codec de áudio AAC compatível com Firebase
    await ffmpeg.exec([
      '-i', inputName,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', outputName
    ])

    onProgress?.({ stage: 'Finalizando…', pct: 85 })
    const data = await ffmpeg.readFile(outputName)
    ffmpeg.deleteFile(inputName)
    ffmpeg.deleteFile(outputName)

    return new Blob([data.buffer], { type: 'video/mp4' })
  } catch (e) {
    console.warn('[FFmpeg] Conversão falhou, usando original:', e.message)
    return blob
  }
}

/**
 * Extrai apenas o áudio de um vídeo e converte para MP3 usando FFmpeg WASM.
 * Útil para enviar apenas o áudio de depoimentos ao Firebase.
 */
async function extractAudioMp3(blob, onProgress) {
  // Tenta com FFmpeg se disponível (requer COOP/COEP — desktop/servidor)
  const ffmpeg = await loadFFmpeg()
  if (!ffmpeg) {
    // Mobile ou ambiente sem SharedArrayBuffer: devolve o blob original
    // Whisper da Groq aceita webm, mp4, ogg diretamente
    onProgress?.({ stage: 'Áudio pronto (sem conversão)', pct: 100 })
    return blob
  }

  try {
    onProgress?.({ stage: 'Carregando FFmpeg…', pct: 5 })
    const ext = blob.type.includes('webm') ? 'webm' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : 'webm'
    const inputName = 'input.' + ext
    const outputName = 'audio.mp3'

    onProgress?.({ stage: 'Lendo arquivo…', pct: 15 })
    ffmpeg.writeFile(inputName, await ffmpeg._fetchFile(blob))

    onProgress?.({ stage: 'Extraindo áudio…', pct: 35 })
    await ffmpeg.exec(['-i', inputName, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-y', outputName])

    onProgress?.({ stage: 'Concluindo…', pct: 90 })
    const data = await ffmpeg.readFile(outputName)
    ffmpeg.deleteFile(inputName)
    ffmpeg.deleteFile(outputName)

    return new Blob([data.buffer], { type: 'audio/mp3' })
  } catch (e) {
    console.warn('[FFmpeg] Extração de áudio falhou, usando original:', e.message)
    return blob
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────

const fmt = {
  date: d => d ? new Date(d).toLocaleDateString('pt-BR') : '—',
  risk: r => ({ high: 'Alto', medium: 'Médio', low: 'Baixo' }[r] || '—'),
  status: s => ({ active: 'Ativo', pending: 'Pendente', closed: 'Encerrado', archived: 'Arquivado' }[s] || s),
}

function riskBadge(level) {
  const map = { high: ['badge-risk-high', 'Alto'], medium: ['badge-risk-med', 'Médio'], low: ['badge-risk-low', 'Baixo'] }
  const [cls, label] = map[level] || ['badge-neutral', '—']
  return `<span class="badge ${cls}">● ${label}</span>`
}

function statusBadge(status) {
  const map = {
    active: ['badge-blue', 'Ativo'], pending: ['badge-gold', 'Pendente'], closed: ['badge-neutral', 'Encerrado'],
    archived: ['badge-neutral', 'Arquivado'], ready: ['badge-teal', 'Pronto'], analyzed: ['badge-teal', 'Analisado'],
    transcribed: ['badge-blue', 'Transcrito'], processing: ['badge-gold', 'Processando'], pending_doc: ['badge-neutral', 'Pendente'],
  }
  const [cls, label] = map[status] || ['badge-neutral', status]
  return `<span class="badge ${cls}">${label}</span>`
}

function progressBar(value, color = 'var(--accent-blue)', height = 4) {
  return `<div class="progress-track" style="height:${height}px"><div class="progress-fill" style="width:${value}%;background:${color};height:${height}px"></div></div>`
}

function spinner(cls = '') {
  return `<span class="spinner ${cls}"></span>`
}

function el(id) { return document.getElementById(id) }
function set(id, html) { const e = el(id); if (e) e.innerHTML = html }
const NAV_ALIAS = { 'case-detail': 'cases', 'new-case': 'cases' }
function syncNav(page) {
  const key = NAV_ALIAS[page] || page
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === key))
}
function navigate(page, elem) {
  state.currentPage = page
  syncNav(page)
  renderPage(page)
  updateHeader(page)
  const m = el('main-content'); if (m) m.scrollTop = 0
}
window.navigate = navigate

// ─── GROQ AI ─────────────────────────────────────────────────────

async function groqChat(messages, systemPrompt = '', opts = {}) {
  const apiKey = opts.apiKey || getGroqKey()
  const model = GROQ_DEPRECATED[opts.model] || opts.model || getGroqModel()
  if (!apiKey) throw new Error('Chave Groq não configurada. Configure em Configurações → Groq AI.')
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, temperature: opts.temperature ?? 0.7, max_tokens: opts.max_tokens ?? 2048,
      messages: [...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []), ...messages],
    }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    let msg = e?.error?.message || `Groq API erro ${res.status}`
    if (res.status === 404 || /decommission|does not exist/i.test(msg)) {
      msg = `O modelo "${model}" não está mais disponível na Groq. Abra Configurações → Groq AI e selecione um modelo atual (ex.: ${GROQ_DEFAULT_MODEL}).`
    } else if (res.status === 401) {
      msg = 'Chave Groq inválida ou expirada. Verifique em Configurações → Groq AI.'
    } else if (res.status === 413 || /too large|context/i.test(msg)) {
      msg = 'Conteúdo longo demais para o modelo. Reduza o texto enviado ou use um modelo com contexto maior.'
    }
    throw new Error(msg)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || ''
}

/**
 * Consulta os modelos realmente disponíveis na conta Groq.
 * Filtra os de áudio/moderação, deixando só os de chat.
 */
async function listGroqModels(apiKey) {
  const key = apiKey?.trim() || getGroqKey()
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e?.error?.message || `Não foi possível listar modelos (HTTP ${res.status})`)
  }
  const data = await res.json()
  return (data.data || [])
    .map(m => m.id)
    .filter(id => !/whisper|tts|guard|orpheus|embed/i.test(id))
    .sort()
}

async function generateScript(witnessData) {
  const { witness, witnessRole, focus = [], actionType = 'outro', caseContext = '' } = witnessData
  const roleLabels = {
    segurado: 'o(a) próprio(a) segurado(a) / parte autora',
    'testemunha-autor': 'testemunha arrolada pela parte autora',
    'testemunha-inss': 'testemunha arrolada pelo INSS',
    'perito-medico': 'perito médico judicial',
    'perito-social': 'perito socioeconômico / assistente social',
    'procurador-inss': 'procurador federal representante do INSS',
  }
  const actionLabels = {
    'aposentadoria-tempo': 'aposentadoria por tempo de contribuição',
    'aposentadoria-especial': 'aposentadoria especial (exposição a agentes nocivos)',
    'aposentadoria-rural': 'aposentadoria rural / segurado especial',
    'aposentadoria-idade': 'aposentadoria por idade (urbana ou híbrida)',
    'incapacidade': 'auxílio por incapacidade temporária (auxílio-doença)',
    'invalidez': 'aposentadoria por incapacidade permanente',
    'bpc': 'BPC/LOAS — benefício assistencial',
    'pensao': 'pensão por morte',
    'maternidade': 'salário-maternidade',
    'acidente': 'auxílio-acidente',
    'revisao': 'revisão de benefício previdenciário',
    'outro': 'ação previdenciária',
  }
  const focusLabels = {
    rural: 'labor rural em regime de economia familiar',
    especial: 'exposição a agentes nocivos e enquadramento de atividade especial',
    qualidade: 'qualidade de segurado, carência e período de graça',
    incapacidade: 'incapacidade laborativa, limitações e rotina',
    dependencia: 'dependência econômica, união estável e vida em comum',
    miserabilidade: 'miserabilidade, renda e composição do grupo familiar',
    provamaterial: 'início de prova material e corroboração testemunhal',
    contradictions: 'contradições e inconsistências',
    testemunho: 'credibilidade e conhecimento direto dos fatos',
  }
  const roleLabel = roleLabels[witnessRole] || 'depoente'
  const actionLabel = actionLabels[actionType] || 'ação previdenciária'
  const focusStr = focus.map(f => focusLabels[f] || f).join(', ') || 'fatos gerais do benefício'
  const systemPrompt = `Você é um assistente jurídico especializado em DIREITO PREVIDENCIÁRIO brasileiro (RGPS, Lei 8.213/91, Lei 8.742/93, Decreto 3.048/99, Súmulas da TNU e do STJ). Gere roteiros de oitiva para audiências de instrução previdenciária (Justiça Federal e Juizados Especiais Federais), objetivos e estratégicos. Sempre responda em JSON válido, sem markdown, sem texto fora do JSON.`
  const userPrompt = `Gere um roteiro de oitiva para "${witness}", na condição de ${roleLabel}, em ação de ${actionLabel}. Foco principal: ${focusStr}. ${caseContext ? `Contexto: ${caseContext}` : ''}

Diretrizes:
- A prova testemunhal deve corroborar início de prova material — explore datas, locais e circunstâncias concretas.
- Em rural: safras, culturas, ferramentas, tamanho da terra, ajuda de terceiros, escola dos filhos, vizinhança.
- Em especial: habitualidade, permanência, agente nocivo, uso e eficácia de EPI, rotina real do posto de trabalho.
- Em incapacidade: rotina diária, esforço exigido, tentativas de retorno ao trabalho, tratamentos.
- Em pensão/BPC: convivência, despesas, renda do grupo familiar, dependência econômica.
- Se o contexto trouxer lacunas na linha do tempo ou períodos com prova frágil, inclua perguntas específicas sobre cada um.

Retorne SOMENTE este JSON:
{"witness":"${witness}","createdAt":"${new Date().toISOString().slice(0,10)}","status":"ready","questions":[{"id":1,"category":"Identificação|Qualidade de Segurado|Período/Vínculo|Atividade Especial|Rural|Incapacidade|Dependência|Prova Material|Contradição","text":"pergunta aqui","rationale":"por que a pergunta importa","aiFlag":false,"priority":"normal|high|critical"}]}

Gere entre 10 e 14 perguntas. Marque aiFlag:true nas que exploram contradições. Prioridade critical para contradições e requisitos legais decisivos, high para fatos centrais do benefício, normal para contexto.`
  const raw = await groqChat([{ role: 'user', content: userPrompt }], systemPrompt, { temperature: 0.5 })
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    if (!Array.isArray(parsed.questions) || !parsed.questions.length) throw new Error('sem perguntas')
    return parsed
  }
  catch { return { witness, createdAt: new Date().toISOString().slice(0,10), status: 'ready', questions: [
    { id: 1, category: 'Identificação', text: 'Desde quando o(a) senhor(a) conhece a parte autora e em que circunstâncias?', rationale: 'Delimita o período que a testemunha pode efetivamente confirmar.', aiFlag: false, priority: 'normal' },
    { id: 2, category: 'Período/Vínculo', text: 'Descreva o trabalho exercido pela parte autora, indicando local, função e período.', rationale: 'Busca confirmação concreta do período alegado.', aiFlag: false, priority: 'high' },
    { id: 3, category: 'Prova Material', text: 'O(a) senhor(a) já viu documentos, recibos ou registros relativos a esse trabalho?', rationale: 'Liga a prova testemunhal ao início de prova material.', aiFlag: false, priority: 'high' },
    { id: 4, category: 'Contradição', text: 'O período que o(a) senhor(a) indica não coincide com o que consta no CNIS. Como explica a divergência?', rationale: 'Confronta o depoimento com a prova documental.', aiFlag: true, priority: 'critical' },
  ] } }
}

async function chatWithAI(message, history = [], caseContext = null) {
  const systemPrompt = `Você é a Lexis, assistente jurídica inteligente especializada em DIREITO PREVIDENCIÁRIO brasileiro (RGPS, benefícios do INSS, BPC/LOAS, Lei 8.213/91, Lei 8.742/93, Decreto 3.048/99, EC 103/2019). Ajuda advogados com análise de casos, requisitos de benefícios, estratégia processual, roteiros de oitiva e relatórios. Seja concisa, precisa e use linguagem técnica adequada.${caseContext ? `\n\nContexto do caso atual:\n${JSON.stringify(caseContext, null, 2)}` : ''}\nNão invente jurisprudência ou normas. Se não souber, diga claramente.`
  const recentHistory = history.slice(-20).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
  return groqChat([...recentHistory, { role: 'user', content: message }], systemPrompt, { temperature: 0.65, max_tokens: 1024 })
}

// ─── GROQ AI — ANÁLISE DE PDF E ÁUDIO ────────────────────────────

/**
 * Lê um PDF como texto via FileReader e analisa juridicamente com Groq.
 * Funciona 100% no navegador, sem dependências externas.
 */
async function analyzePdfWithGroq(file) {
  const key = getGroqKey()
  if (!key) throw new Error('Chave Groq não configurada. Configure em Configurações → Groq AI.')

  // Lê o PDF como texto via URL de objeto + fetch (extrai texto bruto)
  // Para PDFs digitais conseguimos o texto; para escaneados retorna string vazia
  let pdfText = ''
  try {
    const arrayBuffer = await file.arrayBuffer()
    // Extrai strings legíveis do PDF (heurística simples para PDFs digitais)
    const bytes = new Uint8Array(arrayBuffer)
    let raw = ''
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] >= 32 && bytes[i] < 127) raw += String.fromCharCode(bytes[i])
      else raw += ' '
    }
    // Captura blocos de texto entre parênteses (formato PDF interno) e fluxos BT/ET
    const matches = raw.match(/\(([^)]{3,})\)/g) || []
    pdfText = matches.map(m => m.slice(1, -1)).filter(s => /[a-zA-ZÀ-ú]/.test(s)).join(' ')
    if (!pdfText || pdfText.length < 50) {
      // Fallback: extrai qualquer sequência de palavras legíveis >= 4 chars
      pdfText = (raw.match(/[a-zA-ZÀ-ú]{4,}/g) || []).join(' ').slice(0, 8000)
    }
    pdfText = pdfText.slice(0, 8000) // limita tokens
  } catch {}

  if (!pdfText || pdfText.length < 20) {
    throw new Error('Não foi possível extrair texto deste PDF. O arquivo pode ser escaneado (imagem). Tente um PDF digital/editável.')
  }

  const systemPrompt = `Você é um assistente jurídico especializado em DIREITO PREVIDENCIÁRIO brasileiro. Analise documentos previdenciários (CNIS, CTPS, PPP, LTCAT, laudos médicos, carta de concessão/indeferimento, processo administrativo, declarações de sindicato rural, autodeclaração) de forma objetiva. Responda SOMENTE em JSON válido, sem markdown, sem texto fora do JSON.`
  const userPrompt = `Analise o texto extraído deste documento previdenciário e retorne SOMENTE este JSON:\n{"summary":"resumo em 2-3 frases","keyPoints":["ponto 1","ponto 2","ponto 3"],"risks":["risco identificado"],"contradictions":["contradição ou inconsistência (se houver)"],"recommendations":["recomendação jurídica 1","recomendação 2"],"riskLevel":"low|medium|high","documentType":"tipo do documento"}\n\nTexto do documento:\n${pdfText}`

  const raw = await groqChat([{ role: 'user', content: userPrompt }], systemPrompt, { temperature: 0.3, max_tokens: 1500 })
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()) }
  catch { return { summary: raw, keyPoints: [], risks: [], contradictions: [], recommendations: [], riskLevel: 'medium', documentType: 'Documento' } }
}

/**
 * Transcreve áudio via Groq Whisper e analisa juridicamente via Groq Llama.
 */
async function analyzeAudioWithGroq(blob, caseContext = '', opts = {}) {
  const key = getGroqKey()
  if (!key) throw new Error('Chave Groq não configurada. Configure em Configurações → Groq AI.')

  // 1. Tenta extrair MP3 com FFmpeg; se falhar usa blob original
  let audioBlob = blob
  if (!opts.skipConvert) { try { audioBlob = await extractAudioMp3(blob, () => {}) } catch {} }

  // 2. Transcreve com Groq Whisper
  const formData = new FormData()
  const t = (audioBlob.type || '').toLowerCase()
  const ext = /mpeg|mp3/.test(t) ? 'mp3' : /m4a|aac/.test(t) ? 'm4a' : /mp4/.test(t) ? 'mp4' : /ogg|opus/.test(t) ? 'ogg' : /wav/.test(t) ? 'wav' : /flac/.test(t) ? 'flac' : 'webm'
  formData.append('file', new File([audioBlob], `audio.${ext}`, { type: audioBlob.type || 'audio/webm' }))
  formData.append('model', 'whisper-large-v3')
  formData.append('language', 'pt')
  formData.append('response_format', 'json')

  const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: formData,
  })
  if (!whisperRes.ok) {
    const e = await whisperRes.json().catch(() => ({}))
    throw new Error('Erro Whisper: ' + (e?.error?.message || `HTTP ${whisperRes.status}`))
  }
  const whisperData = await whisperRes.json()
  const transcript = whisperData.text?.trim() || ''
  if (!transcript) throw new Error('Transcrição vazia. Verifique se o áudio tem fala audível.')

  // 3. Analisa juridicamente com Groq Llama
  const systemPrompt = `Você é um assistente jurídico especializado em direito brasileiro. Analise transcrições de depoimentos e identifique pontos jurídicos relevantes. Responda SOMENTE em JSON válido, sem markdown.`
  const userPrompt = `Analise este depoimento transcrito e retorne SOMENTE este JSON:\n{"transcript":${JSON.stringify(transcript)},"summary":"resumo do depoimento em 2-3 frases","keyPoints":["ponto relevante 1","ponto 2","ponto 3"],"contradictions":["contradição ou inconsistência (se houver, senão lista vazia)"],"sentiment":"cooperativo|evasivo|contraditório|nervoso|neutro","riskLevel":"low|medium|high","aiFlags":["alerta jurídico importante (se houver, senão lista vazia)"]}\n\nContexto do caso: ${caseContext || 'não informado'}`

  const raw = await groqChat([{ role: 'user', content: userPrompt }], systemPrompt, { temperature: 0.3, max_tokens: 1500 })
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()) }
  catch { return { transcript, summary: raw, keyPoints: [], contradictions: [], sentiment: 'neutro', riskLevel: 'medium', aiFlags: [] } }
}

// ─── FIREBASE DATA ────────────────────────────────────────────────

async function getCases(filters = {}) {
  if (!state.fbReady || !state.fbDb) return []
  try {
    const ref = collection(state.fbDb, 'cases')
    let q = query(ref, orderBy('createdAt', 'desc'))
    if (filters.status && filters.status !== 'all') q = query(ref, where('status', '==', filters.status), orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    let cases = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    if (filters.search) {
      const s = filters.search.toLowerCase()
      cases = cases.filter(c => c.title?.toLowerCase().includes(s) || c.clientName?.toLowerCase().includes(s) || c.number?.toLowerCase().includes(s))
    }
    return cases
  } catch (e) {
    console.error('[Firebase] getCases:', e)
    return []
  }
}

async function createCase(data) {
  if (!state.fbReady || !state.fbDb) throw new Error('Firebase não configurado. Configure em Configurações.')
  const ref = await addDoc(collection(state.fbDb, 'cases'), {
    ...data,
    createdAt: serverTimestamp(),
    status: data.status || 'active',
    completionPct: 0,
    aiAlerts: 0,
    documents: 0,
  })
  return { id: ref.id, ...data }
}

async function updateCase(caseId, data) {
  if (!state.fbReady || !state.fbDb) throw new Error('Firebase não configurado.')
  await updateDoc(doc(state.fbDb, 'cases', caseId), { ...data, updatedAt: serverTimestamp() })
}

async function deleteCase(caseId) {
  if (!state.fbReady || !state.fbDb) throw new Error('Firebase não configurado.')
  await deleteDoc(doc(state.fbDb, 'cases', caseId))
}

async function getDocumentsForCase(caseId) {
  if (!state.fbReady || !state.fbDb) return []
  try {
    const snap = await getDocs(query(collection(state.fbDb, 'cases', caseId, 'documents'), orderBy('uploadedAt', 'desc')))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) {
    console.error('[Firebase] getDocuments:', e)
    return []
  }
}

async function getRecordingsForCase(caseId) {
  if (!state.fbReady || !state.fbDb) return []
  try {
    const snap = await getDocs(query(collection(state.fbDb, 'processos', caseId, 'videos'), orderBy('criadoEm', 'desc')))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) {
    console.error('[Firebase] getRecordings:', e)
    return []
  }
}

// ─── UPLOAD FIREBASE + FFMPEG ─────────────────────────────────────

/**
 * Upload de documento (PDF, DOCX etc.) para Firebase Storage.
 * Salva metadados no Firestore dentro de cases/{caseId}/documents.
 */
async function uploadDocToFirebase(caseId, file, onProgress) {
  if (!state.fbStorage) throw new Error('Firebase Storage não configurado. Adicione o Storage Bucket em Configurações.')

  const path = `cases/${caseId}/documents/${Date.now()}_${file.name}`
  const fileRef = storageRef(state.fbStorage, path)
  const task = uploadBytesResumable(fileRef, file)

  return new Promise((resolve, reject) => {
    task.on('state_changed',
      snap => onProgress?.(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref)
        const docData = {
          name: file.name,
          type: file.type.includes('video') ? 'video' : 'pdf',
          size: `${(file.size / 1048576).toFixed(1)} MB`,
          uploadedAt: serverTimestamp(),
          aiStatus: 'pending',
          risk: null,
          url,
          storagePath: path,
        }
        if (state.fbDb) {
          await addDoc(collection(state.fbDb, 'cases', caseId, 'documents'), docData)
          // Incrementa contador
          try { await updateDoc(doc(state.fbDb, 'cases', caseId), { documents: (state.selectedCase?.documents || 0) + 1 }) } catch {}
        }
        resolve({ ...docData, uploadedAt: new Date().toISOString() })
      }
    )
  })
}

/**
 * Upload de vídeo de depoimento para Firebase Storage.
 * Salva o vídeo renderizado via canvas (com marca d'água) em processos/{processoId}/videos.
 * Salva metadados completos no Firestore em processos/{processoId}/videos.
 */
async function uploadVideoToFirebase(processoId, blob, meta, onProgress) {
  if (!state.fbStorage) throw new Error('Firebase Storage não configurado.')

  onProgress?.({ stage: 'Preparando envio…', pct: 5 })

  // Gera nome do arquivo legível
  const now = new Date()
  const dateStr = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${now.getFullYear()}`
  const timeStr = `${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`
  const nomeSafe = (meta.nomePessoa || 'depoimento').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  const tipoSafe = (meta.tipoDepoimento || 'video').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  const nomeArquivo = `${tipoSafe}_${nomeSafe}_${dateStr}_${timeStr}.webm`
  const path = `processos/${processoId}/videos/${nomeArquivo}`

  const fileRef = storageRef(state.fbStorage, path)
  const task = uploadBytesResumable(fileRef, blob)

  return new Promise((resolve, reject) => {
    task.on('state_changed',
      snap => {
        const pct = 10 + Math.round(snap.bytesTransferred / snap.totalBytes * 80)
        onProgress?.({ stage: 'Enviando vídeo para Firebase…', pct })
      },
      reject,
      async () => {
        onProgress?.({ stage: 'Salvando metadados…', pct: 95 })
        const downloadURL = await getDownloadURL(task.snapshot.ref)
        const videoData = {
          processoId,
          numeroProcesso: meta.numeroProcesso || '',
          tipoDepoimento: meta.tipoDepoimento || '',
          nomePessoa: meta.nomePessoa || '',
          advogado: meta.advogado || '',
          dataInicio: meta.dataInicio || '',
          dataFim: meta.dataFim || '',
          duracao: meta.duracao || '',
          latitude: meta.latitude ?? null,
          longitude: meta.longitude ?? null,
          altitude: meta.altitude ?? null,
          precisaoGps: meta.precisaoGps ?? null,
          cep: meta.cep || '',
          bairro: meta.bairro || '',
          cidade: meta.cidade || '',
          estado: meta.estado || '',
          endereco: meta.endereco || '',
          statusGps: meta.statusGps || 'indisponível',
          videoUrl: downloadURL,
          nomeArquivo,
          criadoEm: serverTimestamp(),
          size: `${(blob.size / 1048576).toFixed(1)} MB`,
        }
        if (state.fbDb) {
          await addDoc(collection(state.fbDb, 'processos', processoId, 'videos'), videoData)
        }
        onProgress?.({ stage: 'Concluído!', pct: 100 })
        resolve({ ...videoData, id: nomeArquivo, criadoEm: new Date().toISOString(), videoUrl: downloadURL })
      }
    )
  })
}

// Mantém compat com código legado
async function uploadRecordingToFirebase(caseId, blob, meta, onProgress) {
  return uploadVideoToFirebase(caseId, blob, meta, onProgress)
}

// ─── LOGIN / LOGOUT ───────────────────────────────────────────────

window.handleLogin = async function() {
  const email = el('login-email').value.trim()
  const password = el('login-password').value
  if (!email || !password) { showLoginError('Preencha e-mail e senha.'); return }

  const btn = el('login-btn')
  el('login-btn-text').textContent = 'Entrando…'
  el('login-btn-spinner').style.display = 'inline-block'
  btn.disabled = true
  el('login-error').style.display = 'none'

  try {
    // ── Modo Demo: Firebase não configurado → entra localmente ──
    if (!state.fbReady || !state.fbAuth) {
      const cfg = loadConfig()
      const name = cfg.userName || email.split('@')[0]
      state.currentUser = {
        id: 'demo-' + Date.now(),
        name,
        email,
        role: 'admin',
        firm: cfg.firmName || 'Lexis AI',
        avatar: name[0].toUpperCase(),
        plan: 'Demo'
      }
      showApp()
      return
    }

    // ── Modo Firebase ──
    const cred = await signInWithEmailAndPassword(state.fbAuth, email, password)
    const u = cred.user
    const cfg = loadConfig()
    state.currentUser = {
      id: u.uid,
      name: u.displayName || cfg.userName || email.split('@')[0],
      email: u.email,
      role: 'admin',
      firm: cfg.firmName || 'Lexis AI',
      avatar: (u.displayName || u.email || 'U')[0].toUpperCase(),
      plan: 'Enterprise'
    }
    showApp()
  } catch (e) {
    showLoginError(e.message || 'Erro ao fazer login.')
    btn.disabled = false
    el('login-btn-text').textContent = 'Entrar'
    el('login-btn-spinner').style.display = 'none'
  }
}

window.handleLogout = async function() {
  if (state.fbAuth) { try { await signOut(state.fbAuth) } catch {} }
  state.currentUser = null
  state.selectedCase = null
  state.cases = []
  state.casesLoaded = false
  setSelectedCase(null)
  state.recordings = []
  state.chatHistory = []
  el('app-main').style.display = 'none'
  el('chat-widget').style.display = 'none'
  el('app-login').style.display = 'flex'
}

function showLoginError(msg) {
  const e = el('login-error')
  e.textContent = msg; e.style.display = 'block'
}

function showApp() {
  el('app-login').style.display = 'none'
  el('app-main').style.display = 'flex'
  el('chat-widget').style.display = 'block'
  const u = state.currentUser
  set('sidebar-avatar', u.avatar || u.name[0].toUpperCase())
  set('sidebar-user-name', u.name)
  navigate('dashboard', null)
  ensureCasesLoaded(null)
}

// ─── HEADER ───────────────────────────────────────────────────────

const pageTitles = {
  dashboard: ['Dashboard', 'Visão geral da carteira previdenciária'],
  cases: ['Casos', 'Gestão de ações previdenciárias'],
  'case-detail': () => [state.selectedCase?.title || 'Detalhe do Caso', state.selectedCase?.number || ''],
  script: () => ['Roteiro Estratégico', state.selectedCase ? `${state.selectedCase.title}` : 'Selecione uma ação'],
  timeline: () => ['Linha do Tempo Contributiva', state.selectedCase ? `${state.selectedCase.title}` : 'Períodos de trabalho e contribuição'],
  'hearing-mode': () => ['Modo Audiência', state.selectedCase ? `${state.selectedCase.title}` : 'Condução da instrução'],
  video: () => ['Depoimentos', state.selectedCase ? state.selectedCase.title : 'Selecione uma ação'],
  reports: () => ['Relatórios e Peças', state.selectedCase ? state.selectedCase.title : 'Selecione uma ação'],
  agenda: ['Agenda', 'Audiências, prazos e compromissos do escritório'],
  'new-case': ['Novo Caso', 'Cadastro de ação previdenciária'],
  settings: ['Configurações', 'Firebase · Groq AI · Escritório'],
}

function updateHeader(page) {
  const cfg = pageTitles[page]
  const [title, sub] = typeof cfg === 'function' ? cfg() : (cfg || [page, ''])
  set('header-title', title)
  set('header-subtitle', sub)
  if (state.selectedCase?.aiAlerts > 0) {
    el('header-alert').style.display = 'block'
    set('header-alert', `${state.selectedCase.aiAlerts} alerta(s) IA`)
  } else {
    el('header-alert').style.display = 'none'
  }
}

// ─── PAGE ROUTER ─────────────────────────────────────────────────

function renderPage(page) {
  const main = el('main-content')
  main.className = 'fade-in'
  switch (page) {
    case 'dashboard': renderDashboard(); break
    case 'cases': renderCases(); break
    case 'case-detail': renderCaseDetail(); break
    case 'timeline': state.scriptTab = 'timeline'; renderScript(); break
    case 'hearing-mode': state.scriptTab = 'hearing'; renderScript(); break
    case 'script': state.scriptTab = 'form'; renderScript(); break
    case 'agenda': renderAgenda(); break
    case 'video': renderVideo(); break
    case 'reports': renderReports(); break
    case 'new-case': renderNewCase(); break
    case 'settings': renderSettings(); break
    default: renderDashboard()
  }
  if (CASE_PAGES.includes(page)) ensureCasesLoaded(page)
}

// ─── DASHBOARD ────────────────────────────────────────────────────

async function renderDashboard() {
  set('main-content', `
    <div class="grid-4" style="margin-bottom:24px">
      ${[1,2,3,4].map(() => `<div class="card metric-card"><div class="skeleton" style="height:16px;width:60%;margin-bottom:10px"></div><div class="skeleton" style="height:26px;width:40%"></div></div>`).join('')}
    </div>
    <div id="dash-body">
      <div style="text-align:center;padding:48px">${spinner('spinner-lg')}</div>
    </div>
  `)

  let cases = []
  try { cases = await getCases() } catch {}
  // Mantém as ações criadas em modo demo junto com as do Firebase
  const localCases = state.cases.filter(c => String(c.id).startsWith('local-'))
  cases = [...localCases, ...cases]
  if (state.selectedCase) cases = cases.map(c => (c.id === state.selectedCase.id ? state.selectedCase : c))
  state.cases = cases
  state.casesLoaded = true
  updateAgendaBadge()

  const active = cases.filter(c => c.status === 'active').length
  const closed = cases.filter(c => c.status === 'closed').length
  const pending = cases.filter(c => c.status === 'pending').length
  const highRisk = cases.filter(c => c.riskLevel === 'high').length

  const demoBanner = !state.fbReady ? `
    <div class="alert-warn" style="margin-bottom:20px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span>⚙️ <strong>Modo Demo</strong> — Firebase não configurado. Os dados ficam apenas nesta sessão.</span>
      <button class="btn btn-sm btn-secondary" onclick="navigate('settings',document.querySelector('.nav-item[data-page=settings]'))" style="margin-left:auto">Configurar Firebase</button>
    </div>` : ''

  set('main-content', `
    ${demoBanner}
    <div class="grid-4" style="margin-bottom:24px">
      ${metricCard('Ações Ativas', active, 'Em andamento', 'var(--accent-blue)')}
      ${metricCard('Pendentes', pending, 'Aguardando ação', 'var(--risk-med)')}
      ${metricCard('Encerrados', closed, 'Total concluídos', 'var(--risk-low)')}
      ${metricCard('Alto Risco', highRisk, 'Requer atenção', 'var(--risk-high)')}
    </div>

    ${agendaWidget()}

    <div class="card" style="overflow:hidden">
      <div style="padding:18px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <span class="section-title">Casos Recentes</span>
        <button class="btn btn-ghost btn-sm" onclick="navigate('cases',document.querySelector('.nav-item[data-page=cases]'))">Ver todos →</button>
      </div>
      ${cases.length === 0
        ? `<div class="empty-state"><div class="empty-icon">📁</div><div class="empty-title">Nenhum caso cadastrado</div><div class="empty-desc">Crie seu primeiro caso para começar.</div><div style="margin-top:16px"><button class="btn btn-primary btn-sm" onclick="navigate('new-case',null)">Criar Caso</button></div></div>`
        : `<table>
            <thead><tr><th>Ação / Segurado(a)</th><th>Status</th><th>Risco</th><th>Progresso</th><th>Próx. Audiência</th></tr></thead>
            <tbody>
              ${cases.slice(0,5).map(c => `
                <tr style="cursor:pointer" onclick="selectCase('${c.id}')">
                  <td>
                    <div style="font-weight:500">${c.title}</div>
                    <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">${c.number || '—'}</div>
                  </td>
                  <td>${statusBadge(c.status)}</td>
                  <td>${riskBadge(c.riskLevel)}</td>
                  <td style="width:120px">
                    ${progressBar(c.completionPct || 0)}
                    <span style="font-size:11px;color:var(--text-muted)">${c.completionPct || 0}%</span>
                  </td>
                  <td style="font-size:12px;color:var(--text-muted)">${c.nextHearing ? fmt.date(c.nextHearing) : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`
      }
    </div>
  `)
}

function metricCard(label, value, sub, color) {
  return `
    <div class="card metric-card fade-up">
      <div class="metric-card-header">
        <span class="metric-label">${label}</span>
        <div class="metric-icon" style="background:${color}18;color:${color}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/></svg>
        </div>
      </div>
      <div>
        <div class="metric-value">${value}</div>
        <div class="metric-sub">${sub}</div>
      </div>
    </div>`
}

// ─── CASES LIST ───────────────────────────────────────────────────

async function renderCases(filters = {}) {
  set('main-content', `
    <div class="page-actions">
      <input type="text" id="cases-search" placeholder="Buscar por título, segurado(a), NB ou nº do processo…" style="max-width:340px" oninput="filterCases()" />
      <select id="cases-status-filter" onchange="filterCases()">
        <option value="all">Todos os status</option>
        <option value="active">Ativo</option>
        <option value="pending">Pendente</option>
        <option value="closed">Encerrado</option>
      </select>
      <button class="btn btn-primary btn-sm" onclick="navigate('new-case',null)" style="margin-left:auto">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Novo Caso
      </button>
    </div>
    <div id="cases-list">
      ${[1,2,3].map(() => `<div class="card" style="padding:20px;margin-bottom:12px"><div class="skeleton" style="height:16px;width:60%;margin-bottom:12px"></div><div class="skeleton" style="height:12px;width:40%"></div></div>`).join('')}
    </div>
  `)

  try {
    const fetched = await getCases()
    const local = state.cases.filter(c => String(c.id).startsWith('local-'))
    let cases = [...local, ...fetched]
    if (state.selectedCase) cases = cases.map(c => (c.id === state.selectedCase.id ? state.selectedCase : c))
    state.cases = cases
    state.casesLoaded = true
    updateAgendaBadge()
    renderCasesList(cases)
  } catch (e) {
    set('cases-list', `<div class="alert-error">${e.message}</div>`)
  }
}

function renderCasesList(cases) {
  set('cases-list', cases.length === 0
    ? `<div class="card"><div class="empty-state"><div class="empty-icon">📁</div><div class="empty-title">Nenhum caso encontrado</div><div class="empty-desc">Crie um novo caso para começar.</div><div style="margin-top:16px"><button class="btn btn-primary btn-sm" onclick="navigate('new-case',null)">Criar Caso</button></div></div></div>`
    : cases.map(c => `
      <div class="card card-interactive" style="padding:20px;margin-bottom:12px" onclick="selectCase('${c.id}')">
        <div style="display:flex;align-items:flex-start;gap:16px">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
              ${statusBadge(c.status)} ${riskBadge(c.riskLevel)}
              ${(c.tags || []).map(t => `<span class="badge badge-neutral">${t}</span>`).join('')}
            </div>
            <div style="font-size:15px;font-weight:600;margin-bottom:2px">${c.title}</div>
            <div style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">${c.number || '—'}</div>
            <div style="display:flex;gap:24px;margin-top:10px;flex-wrap:wrap">
              ${[['Segurado(a)', c.clientName], ['Benefício', c.benefit], ['Vara / JEF', c.court], ['NB', c.nb]].filter(f => f[1]).map(f => `
                <div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">${f[0]}</div><div style="font-size:13px;font-weight:500">${f[1]}</div></div>
              `).join('')}
            </div>
          </div>
          <div style="text-align:right;min-width:100px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Progresso</div>
            <div style="font-size:20px;font-weight:700;color:var(--accent-blue)">${c.completionPct || 0}%</div>
            <div style="width:90px;margin-top:6px">${progressBar(c.completionPct || 0, 'var(--accent-blue)', 4)}</div>
            ${c.aiAlerts > 0 ? `<div style="margin-top:8px"><span class="badge badge-gold">${c.aiAlerts} alertas IA</span></div>` : ''}
            <button class="btn btn-ghost btn-sm" style="margin-top:8px;color:var(--risk-high)" onclick="event.stopPropagation();confirmDeleteCase('${c.id}','${c.title.replace(/'/g,"\\'")}')">Excluir</button>
          </div>
        </div>
      </div>
    `).join('')
  )
}

window.filterCases = function() {
  const search = el('cases-search')?.value || ''
  const status = el('cases-status-filter')?.value || 'all'
  const filtered = state.cases.filter(c => {
    const matchStatus = status === 'all' || c.status === status
    const matchSearch = !search || c.title?.toLowerCase().includes(search.toLowerCase()) || c.clientName?.toLowerCase().includes(search.toLowerCase()) || c.number?.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })
  renderCasesList(filtered)
}

window.confirmDeleteCase = async function(id, title) {
  if (!confirm(`Excluir o caso "${title}"?\nEsta ação não pode ser desfeita.`)) return
  try {
    await deleteCase(id)
    state.cases = state.cases.filter(c => c.id !== id)
    renderCasesList(state.cases)
  } catch (e) {
    alert('Erro ao excluir: ' + e.message)
  }
}

window.selectCase = function(id) {
  const c = state.cases.find(x => x.id === id)
  if (!c) return
  setSelectedCase(c)
  navigate('case-detail', null)
}

// ─── CASE DETAIL ──────────────────────────────────────────────────

async function renderCaseDetail() {
  if (!state.selectedCase) {
    set('main-content', `<div class="alert-warn">⚠ Nenhum caso selecionado. Acesse a lista de Casos e clique em um deles.</div>`)
    return
  }
  const c = state.selectedCase
  const daysToHearing = c.nextHearing ? Math.ceil((new Date(c.nextHearing) - new Date()) / 86400000) : null

  set('main-content', `
    <div class="card" style="padding:22px;margin-bottom:20px">
      <div style="display:flex;align-items:flex-start;gap:20px">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
            ${statusBadge(c.status)} ${riskBadge(c.riskLevel)}
            ${(c.tags || []).map(t => `<span class="badge badge-neutral">${t}</span>`).join('')}
          </div>
          <h1 style="font-size:20px;font-weight:700;letter-spacing:-0.01em;margin-bottom:4px">${c.title}</h1>
          <div style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">${c.number || '—'}</div>
          <div class="case-header-meta">
            ${[['Segurado(a)', c.clientName], ['Benefício', c.benefit], ['NB', c.nb], ['DER', c.der ? fmt.date(c.der) : ''], ['Vara / Juizado', c.court], ['Juiz(a)', c.judge], ['Valor da causa', c.value], ['Próx. Audiência', c.nextHearing ? fmt.date(c.nextHearing) : '—']].filter(f => f[1]).map(f => `
              <div><div class="case-meta-label">${f[0]}</div><div class="case-meta-value">${f[1]}</div></div>
            `).join('')}
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Progresso geral</div>
          <div id="case-pct" style="font-size:32px;font-weight:700;color:var(--accent-blue);letter-spacing:-0.03em">${c.completionPct || 0}%</div>
          <div id="case-pct-bar" style="width:120px;margin-top:8px">${progressBar(c.completionPct || 0, 'var(--accent-blue)', 6)}</div>
        </div>
      </div>
    </div>

    <div class="page-actions">
      <button class="btn btn-secondary btn-sm" onclick="navigate('timeline',null)">Linha do Tempo</button>
      <button class="btn btn-primary btn-sm" onclick="navigate('script',null)">Roteiro de Oitiva</button>
      <button class="btn btn-secondary btn-sm" onclick="navigate('hearing-mode',null)">Modo Audiência</button>
      <button class="btn btn-secondary btn-sm" onclick="navigate('video',document.querySelector('.nav-item[data-page=video]'))">Depoimentos</button>
      <button class="btn btn-secondary btn-sm" onclick="navigate('reports',document.querySelector('.nav-item[data-page=reports]'))">Relatórios</button>
      <button class="btn btn-gold btn-sm" onclick="exportCaseTxt()">Exportar TXT</button>
      <button class="btn btn-secondary btn-sm" onclick="openEditCase()">Editar Caso</button>
    </div>

    <div class="tabs">
      <button class="tab-btn active" onclick="switchCaseTab(this,'overview')">Visão Geral</button>
      <button class="tab-btn" onclick="switchCaseTab(this,'checklist')">Checklist</button>
      <button class="tab-btn" onclick="switchCaseTab(this,'documents')">Documentos</button>
      <button class="tab-btn" onclick="switchCaseTab(this,'ai')">Análise IA</button>
    </div>

    <div id="case-tab-content">
      ${renderCaseOverviewTab(c, daysToHearing)}
    </div>
  `)
}

function renderCaseOverviewTab(c, daysToHearing) {
  return `
    <div class="grid-auto">
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="grid-3">
          ${[['Documentos', c.documents || 0], ['Alertas IA', c.aiAlerts || 0], ['Dias até audiência', daysToHearing !== null ? (daysToHearing > 0 ? daysToHearing : 'Hoje!') : '—']].map(([l, v]) => `
            <div class="card" style="padding:16px;text-align:center">
              <div style="font-size:24px;font-weight:700">${v}</div>
              <div style="font-size:11px;color:var(--text-muted)">${l}</div>
            </div>
          `).join('')}
        </div>
        ${c.notes ? `<div class="card" style="padding:18px"><div class="section-muted" style="margin-bottom:8px">Observações</div><div style="font-size:13px;color:var(--text-secondary);line-height:1.6">${c.notes}</div></div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card" style="padding:16px">
          <div class="section-muted" style="margin-bottom:12px">Informações</div>
          ${[['Status', statusBadge(c.status)], ['Risco', riskBadge(c.riskLevel)], ['Criado em', c.createdAt?.toDate ? fmt.date(c.createdAt.toDate()) : (c.createdAt ? fmt.date(c.createdAt) : '—')]].map(([l, v]) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px">
              <span style="color:var(--text-muted)">${l}</span><span>${v}</span>
            </div>
          `).join('')}
        </div>
        <div class="card" style="padding:16px">
          <div class="section-muted" style="margin-bottom:12px">Ações Rápidas</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="btn btn-secondary btn-sm" onclick="navigate('script',document.querySelector('.nav-item[data-page=script]'))">Gerar Roteiro</button>
            <button class="btn btn-secondary btn-sm" onclick="navigate('video',document.querySelector('.nav-item[data-page=video]'))">Gravar Depoimento</button>
            <button class="btn btn-secondary btn-sm" onclick="navigate('reports',document.querySelector('.nav-item[data-page=reports]'))">Gerar Relatório</button>
          </div>
        </div>
      </div>
    </div>`
}

window.switchCaseTab = async function(btn, tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  const c = state.selectedCase
  const daysToHearing = c?.nextHearing ? Math.ceil((new Date(c.nextHearing) - new Date()) / 86400000) : null

  if (tab === 'overview') {
    set('case-tab-content', renderCaseOverviewTab(c, daysToHearing))
  } else if (tab === 'checklist') {
    set('case-tab-content', renderChecklistTab(c))
  } else if (tab === 'documents') {
    set('case-tab-content', `<div style="text-align:center;padding:32px">${spinner('spinner-lg')}</div>`)
    const docs = await getDocumentsForCase(c.id)
    set('case-tab-content', renderDocsTab(c, docs))
  } else if (tab === 'ai') {
    set('case-tab-content', `
      <div class="card" style="padding:24px">
        <div style="font-size:14px;font-weight:600;margin-bottom:16px">Sugestões da IA para este caso</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${[['Gerar roteiro de oitiva', 'A IA analisa os períodos contributivos e cria perguntas estratégicas para a audiência.', 'script'],
             ['Parecer probatório', 'Análise de prova material, testemunhal, contradições e risco de improcedência.', 'reports'],
             ['Gravar depoimento', 'Grave e transcreva depoimentos com análise automática.', 'video']].map(([t, d, p], i) => `
            <div style="display:flex;gap:12px;padding:12px 0;${i < 2 ? 'border-bottom:1px solid var(--border)' : ''}">
              <div style="flex:1">
                <div style="font-size:13px;font-weight:500;margin-bottom:2px">${t}</div>
                <div style="font-size:12px;color:var(--text-muted);line-height:1.4;margin-bottom:8px">${d}</div>
                <button class="btn btn-secondary btn-sm" onclick="navigate('${p}',document.querySelector('.nav-item[data-page=${p}]'))">Ir agora</button>
              </div>
            </div>`).join('')}
        </div>
      </div>`)
  }
}

// Armazena arquivos da sessão para análise IA local
if (!state._localFiles) state._localFiles = {}

function renderDocsTab(c, docs) {
  // Mescla docs do Firebase com arquivos locais da sessão
  const localDocs = Object.entries(state._localFiles || {}).map(([id, f]) => ({
    id, name: f.name,
    type: f.type.includes('pdf') ? 'pdf' : f.type.includes('video') ? 'video' : f.type.includes('audio') ? 'audio' : 'file',
    size: `${(f.size/1048576).toFixed(1)} MB`,
    uploadedAt: new Date().toISOString(),
    aiStatus: state._localAnalyzed?.[id] ? 'analyzed' : 'pending',
    _local: true,
  }))
  const allDocs = [...localDocs, ...docs.filter(d => !state._localFiles?.[d.id])]

  return `
    <div id="upload-zone" class="upload-zone" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleDocDrop(event)" onclick="el('doc-file-input').click()">
      <div style="font-size:28px;margin-bottom:8px;opacity:.5">📎</div>
      <div style="font-size:14px;font-weight:500">Arraste arquivos ou clique para fazer upload</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:4px">PDF, MP3, MP4, WAV, DOCX — análise IA disponível para PDF e áudio/vídeo</div>
    </div>
    <input type="file" id="doc-file-input" style="display:none" onchange="handleDocFileSelect(event)" accept=".pdf,.docx,.doc,.mp4,.mp3,.wav,.webm,.ogg,.zip" multiple />
    <div id="upload-progress" style="display:none;margin-bottom:16px">
      <div style="max-width:300px">${progressBar(0, 'var(--accent-blue)', 6)}</div>
      <div id="upload-progress-label" style="font-size:12px;color:var(--text-muted);margin-top:6px">Aguardando…</div>
    </div>
    <div id="ai-doc-panel" style="display:none;margin-bottom:16px"></div>
    <div class="card" style="overflow:hidden">
      <table>
        <thead><tr><th>Arquivo</th><th>Tipo</th><th>Tamanho</th><th>Data</th><th>Status IA</th><th></th></tr></thead>
        <tbody id="docs-tbody">
          ${allDocs.length === 0
            ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">Nenhum documento ainda — arraste um arquivo acima</td></tr>`
            : allDocs.map(d => `
              <tr id="doc-row-${d.id}">
                <td><div style="display:flex;align-items:center;gap:10px">
                  <span style="font-size:20px">${d.type==='video'?'🎬':d.type==='audio'?'🎵':'📄'}</span>
                  <div>
                    <div style="font-size:13px;font-weight:500">${d.name}</div>
                    ${d._local ? `<span style="font-size:11px;color:var(--text-muted)">Sessão atual</span>` : d.url ? `<a href="${d.url}" target="_blank" style="font-size:11px;color:var(--accent-blue)">Abrir</a>` : ''}
                  </div>
                </div></td>
                <td><span class="badge badge-neutral">${(d.type||'file').toUpperCase()}</span></td>
                <td style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">${d.size||'—'}</td>
                <td style="font-size:12px;color:var(--text-muted)">${d.uploadedAt?.toDate ? fmt.date(d.uploadedAt.toDate()) : fmt.date(d.uploadedAt)}</td>
                <td id="doc-status-${d.id}">${statusBadge(d.aiStatus||'pending')}</td>
                <td>${d._local && (d.type==='pdf'||d.type==='audio'||d.type==='video')
                  ? `<button class="btn btn-secondary btn-sm" onclick="analyzeDocIA('${d.id}')">🔍 Analisar IA</button>`
                  : ''}</td>
              </tr>`).join('')}
        </tbody>
      </table>
    </div>`
}

window.handleDocDrop = function(e) {
  e.preventDefault()
  el('upload-zone')?.classList.remove('drag-over')
  const files = Array.from(e.dataTransfer.files)
  files.forEach(f => uploadDoc(f))
}
window.handleDocFileSelect = function(e) {
  const files = Array.from(e.target.files)
  files.forEach(f => uploadDoc(f))
  e.target.value = '' // permite reselecionar o mesmo arquivo
}

async function uploadDoc(file) {
  // Salva localmente na sessão (sempre funciona, sem Firebase)
  if (!state._localFiles) state._localFiles = {}
  const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2,6)}`
  state._localFiles[localId] = file

  // Recarrega a aba para mostrar o arquivo imediatamente
  switchCaseTab(
    document.querySelector('.tab-btn.active') || { classList: { add: () => {}, remove: () => {} } },
    'documents'
  )

  // Tenta enviar ao Firebase Storage em segundo plano (silenciosamente)
  if (state.fbStorage && state.selectedCase) {
    const prog = el('upload-progress')
    if (prog) {
      prog.style.display = 'block'
      el('upload-progress-label').textContent = 'Enviando ao Firebase…'
    }
    uploadDocToFirebase(state.selectedCase.id, file, pct => {
      if (prog) {
        prog.querySelector('.progress-track .progress-fill').style.width = pct + '%'
        el('upload-progress-label').textContent = `Firebase… ${pct}%`
      }
    }).then(() => {
      if (prog) prog.style.display = 'none'
    }).catch(() => {
      if (prog) prog.style.display = 'none'
    })
  }

  // Se for PDF ou áudio/vídeo, mostra botão de análise
  const isPdf = file.type.includes('pdf')
  const isMedia = file.type.includes('audio') || file.type.includes('video')
  if (isPdf || isMedia) {
    setTimeout(() => {
      const panel = el('ai-doc-panel')
      if (!panel) return
      panel.style.display = 'block'
      panel.innerHTML = `
        <div class="card" style="padding:14px 18px;border-left:3px solid var(--accent-blue);display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <div style="font-size:13px;font-weight:500">${isPdf ? '📄' : '🎙️'} <strong>${file.name}</strong> pronto para análise</div>
            <div style="font-size:12px;color:var(--text-muted)">${isPdf ? 'Análise jurídica de PDF com Groq AI' : 'Transcrição Whisper + análise jurídica com Groq AI'}</div>
          </div>
          <button class="btn btn-primary btn-sm" style="white-space:nowrap" onclick="analyzeDocIA('${localId}')">🔍 Analisar com IA</button>
        </div>`
    }, 200)
  }
}

window.analyzeDocIA = async function(docId) {
  const file = state._localFiles?.[docId]
  if (!file) { alert('Arquivo não encontrado na sessão. Faça o upload novamente.'); return }

  const panel = el('ai-doc-panel')
  if (panel) {
    panel.style.display = 'block'
    panel.innerHTML = `<div class="card" style="padding:20px"><div style="display:flex;align-items:center;gap:12px">${spinner('spinner-lg')}<div><div style="font-size:13px;font-weight:500">Analisando com Groq AI…</div><div style="font-size:12px;color:var(--text-muted)">${file.type.includes('pdf') ? 'Extraindo texto e interpretando juridicamente' : 'Transcrevendo com Whisper e analisando'}</div></div></div></div>`
  }

  const statusCell = el(`doc-status-${docId}`)
  if (statusCell) statusCell.innerHTML = statusBadge('processing')

  try {
    const isPdf = file.type.includes('pdf')
    const caseCtx = state.selectedCase ? `${state.selectedCase.title} — ${state.selectedCase.clientName || ''}` : ''
    const result = isPdf
      ? await analyzePdfWithGroq(file)
      : await analyzeAudioWithGroq(file, caseCtx)

    if (!state._localAnalyzed) state._localAnalyzed = {}
    state._localAnalyzed[docId] = true
    if (statusCell) statusCell.innerHTML = statusBadge('analyzed')

    renderAIResultPanel(result, isPdf ? 'pdf' : 'audio', file.name)

    // Salva status no Firebase se disponível
    if (state.fbDb && state.selectedCase) {
      try { await updateDoc(doc(state.fbDb, 'cases', state.selectedCase.id, 'documents', docId), { aiStatus: 'analyzed', riskLevel: result.riskLevel }) } catch {}
    }
  } catch (e) {
    if (panel) panel.innerHTML = `<div class="card" style="padding:16px;border-left:3px solid var(--risk-high)"><div style="font-size:13px;font-weight:600;color:var(--risk-high);margin-bottom:6px">Erro na análise</div><div style="font-size:12px;color:var(--text-muted);line-height:1.6">${e.message}</div></div>`
    if (statusCell) statusCell.innerHTML = statusBadge('pending')
  }
}

function renderAIResultPanel(result, type, filename) {
  const panel = el('ai-doc-panel')
  if (!panel) return
  window._lastAIResult = { result, type, filename }

  const riskColor = { low: 'var(--risk-low)', medium: 'var(--risk-med)', high: 'var(--risk-high)' }[result.riskLevel] || 'var(--accent-blue)'
  const sentimentIcon = { cooperativo: '😊', evasivo: '😶', contraditório: '⚠️', nervoso: '😰', neutro: '😐' }[result.sentiment] || ''

  let html = `
    <div class="card fade-up" style="padding:22px;border-left:3px solid ${riskColor}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;gap:12px">
        <div>
          <div style="font-size:14px;font-weight:600">${type==='pdf'?'📄':'🎙️'} Análise IA — ${filename}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${new Date().toLocaleString('pt-BR')}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          ${result.riskLevel ? riskBadge(result.riskLevel) : ''}
          ${result.documentType ? `<span class="badge badge-neutral">${result.documentType}</span>` : ''}
          ${result.sentiment ? `<span class="badge badge-blue">${sentimentIcon} ${result.sentiment}</span>` : ''}
          <button onclick="el('ai-doc-panel').style.display='none'" style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;padding:0;line-height:1">×</button>
        </div>
      </div>
      <div style="font-size:13px;line-height:1.7;color:var(--text-secondary);padding:12px;background:var(--bg-elevated);border-radius:var(--radius-sm);margin-bottom:14px">${result.summary||''}</div>`

  if (type === 'audio' && result.transcript) {
    html += `
      <div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px">📝 Transcrição</div>
        <div style="font-size:12px;line-height:1.8;color:var(--text-secondary);max-height:160px;overflow-y:auto;padding:10px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)">${result.transcript}</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="navigator.clipboard.writeText(${JSON.stringify(result.transcript || '')}).then(()=>this.textContent='Copiado!')">Copiar transcrição</button>
      </div>`
  }

  const sections = [
    { key: 'keyPoints',      label: '✅ Pontos-Chave',     color: 'var(--risk-low)' },
    { key: 'risks',          label: '⚠ Riscos',            color: 'var(--risk-med)' },
    { key: 'contradictions', label: '🔴 Contradições',     color: 'var(--risk-high)' },
    { key: 'aiFlags',        label: '🚨 Alertas IA',       color: 'var(--risk-high)' },
    { key: 'recommendations',label: '💡 Recomendações',    color: 'var(--accent-blue)' },
  ]
  sections.forEach(({ key, label, color }) => {
    const items = (result[key] || []).filter(Boolean)
    if (!items.length) return
    html += `<div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px">${label}</div>
      ${items.map(item => `<div style="font-size:12px;line-height:1.5;padding:7px 10px;margin-bottom:4px;background:var(--bg-elevated);border-radius:var(--radius-sm);border-left:2px solid ${color}">${item}</div>`).join('')}
    </div>`
  })

  html += `
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <button class="btn btn-secondary btn-sm" onclick="exportAIResult()">⬇ Exportar análise TXT</button>
      </div>
    </div>`

  panel.innerHTML = html
}

window.exportAIResult = function() {
  const r = window._lastAIResult; if (!r) return
  const { result, type, filename } = r
  const lines = [
    `ANÁLISE IA — ${filename}`,
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    `Risco: ${result.riskLevel || '—'}`,
    '',
  ]
  if (result.summary) lines.push('=== RESUMO ===', result.summary, '')
  if (result.transcript) lines.push('=== TRANSCRIÇÃO ===', result.transcript, '')
  ;[['keyPoints','PONTOS-CHAVE'],['risks','RISCOS'],['contradictions','CONTRADIÇÕES'],['aiFlags','ALERTAS IA'],['recommendations','RECOMENDAÇÕES']].forEach(([k,label]) => {
    const items = (result[k]||[]).filter(Boolean)
    if (items.length) lines.push(`=== ${label} ===`, ...items.map(i=>`• ${i}`), '')
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }))
  a.download = `analise_${filename.replace(/\s+/g,'_')}.txt`
  a.click()
}

window.openEditCase = function() {
  const c = state.selectedCase; if (!c) return
  const html = `
    <div id="edit-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:500;display:flex;align-items:center;justify-content:center" onclick="if(event.target===this)closeEditCase()">
      <div class="card" style="width:520px;max-width:92vw;padding:28px;max-height:85vh;overflow-y:auto" onclick="event.stopPropagation()">
        <div style="font-size:15px;font-weight:600;margin-bottom:20px">Editar Caso</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="field"><label>Título *</label><input type="text" id="edit-title" value="${c.title || ''}" /></div>
          <div class="grid-2">
            <div class="field"><label>Status</label><select id="edit-status">
              <option value="active" ${c.status==='active'?'selected':''}>Ativo</option>
              <option value="pending" ${c.status==='pending'?'selected':''}>Pendente</option>
              <option value="closed" ${c.status==='closed'?'selected':''}>Encerrado</option>
            </select></div>
            <div class="field"><label>Risco</label><select id="edit-risk">
              <option value="low" ${c.riskLevel==='low'?'selected':''}>Baixo</option>
              <option value="medium" ${c.riskLevel==='medium'?'selected':''}>Médio</option>
              <option value="high" ${c.riskLevel==='high'?'selected':''}>Alto</option>
            </select></div>
          </div>
          <div class="grid-2">
            <div class="field"><label>Telefone / WhatsApp do(a) segurado(a)</label><input type="text" id="edit-phone" value="${esc(c.clientPhone || '')}" inputmode="tel" /></div>
            <div class="field"><label>Horário da audiência</label><input type="time" id="edit-hearing-time" value="${esc(c.nextHearingTime || '')}" /></div>
          </div>
          <div class="field"><label>Progresso (%)</label><input type="number" id="edit-pct" min="0" max="100" value="${c.completionPct || 0}" /></div>
          <div class="field"><label>Próxima Audiência</label><input type="date" id="edit-hearing" value="${c.nextHearing || ''}" style="background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-md);border-radius:var(--radius-sm);padding:8px 12px;font-family:inherit" /></div>
          <div class="field"><label>Observações</label><textarea id="edit-notes">${c.notes || ''}</textarea></div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
          <button class="btn btn-ghost" onclick="closeEditCase()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveEditCase()">Salvar</button>
        </div>
      </div>
    </div>`
  document.body.insertAdjacentHTML('beforeend', html)
}
window.closeEditCase = function() { el('edit-overlay')?.remove() }
window.saveEditCase = async function() {
  const data = {
    title: el('edit-title').value.trim(),
    status: el('edit-status').value,
    riskLevel: el('edit-risk').value,
    completionPct: parseInt(el('edit-pct').value) || 0,
    nextHearing: el('edit-hearing').value || null,
    nextHearingTime: el('edit-hearing-time')?.value || '',
    clientPhone: el('edit-phone')?.value.trim() || '',
    notes: el('edit-notes').value,
  }
  if (!data.title) { alert('Título obrigatório.'); return }
  try {
    await saveCaseFields(state.selectedCase.id, data, { immediate: true })
    closeEditCase()
    renderCaseDetail()
  } catch (e) { alert('Erro: ' + e.message) }
}

window.exportCaseTxt = function() {
  const c = state.selectedCase; if (!c) return
  const content = `LEXIS AI — EXPORTAÇÃO DO CASO\n${'='.repeat(40)}\n\nCASO: ${c.title}\nPROCESSO: ${c.number || '—'}\nSEGURADO(A): ${c.clientName || '—'}\nBENEFÍCIO: ${c.benefit || '—'}\nNB: ${c.nb || '—'}\nDER: ${c.der ? fmt.date(c.der) : '—'}\nVARA / JUIZADO: ${c.court || '—'}\nJUIZ(A): ${c.judge || '—'}\nSTATUS: ${fmt.status(c.status)}\nRISCO: ${fmt.risk(c.riskLevel)}\nVALOR: ${c.value || '—'}\nPRÓXIMA AUDIÊNCIA: ${c.nextHearing ? fmt.date(c.nextHearing) : '—'}\nPROGRESSO: ${c.completionPct || 0}%\n\nGerado por Lexis AI em ${new Date().toLocaleDateString('pt-BR')}`
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' })); a.download = `${c.title.replace(/\s+/g,'_')}_resumo.txt`; a.click()
}

// ─── NÚCLEO: PERSISTÊNCIA POR AÇÃO, SELETOR DE AÇÃO, UTILITÁRIOS ──
// Tudo que o advogado cadastra (linha do tempo, roteiros, anotações da oitiva,
// relatórios, checklist, prazos) é gravado dentro do documento da própria ação
// (cases/{id}), então funciona com as regras do Firestore que você já usa.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}
const clone = v => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)))
const uid = (p = 'id') => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.round((new Date(dateStr + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000)
}
function fmtBR(dateStr) {
  if (!dateStr) return '—'
  const [y, m, d] = String(dateStr).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
function downloadText(filename, text, mime = 'text/plain') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }))
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

const _pending = {}
const _timers = {}
function isDemoCase(c) { return !state.fbReady || !state.fbDb || String(c?.id || '').startsWith('local-') }

function setSaveIndicator(txt, cls = '') {
  const e = el('lx-save-state')
  if (e) { e.textContent = txt; e.className = 'lx-save-state ' + cls }
}

/** Atualiza campos da ação em memória e no Firestore (com debounce). */
function saveCaseFields(caseId, patch, opts = {}) {
  if (!caseId) return Promise.resolve()
  const targets = [state.selectedCase, ...state.cases].filter(c => c && c.id === caseId)
  targets.forEach(c => Object.assign(c, patch))
  const c = targets[0]
  if (!c || isDemoCase(c)) { setSaveIndicator('Salvo nesta sessão'); updateAgendaBadge(); return Promise.resolve() }
  _pending[caseId] = { ...(_pending[caseId] || {}), ...patch }
  clearTimeout(_timers[caseId])
  setSaveIndicator('Salvando…')
  const flush = async () => {
    const data = _pending[caseId]
    delete _pending[caseId]
    if (!data) return
    try {
      await updateCase(caseId, JSON.parse(JSON.stringify(data)))
      setSaveIndicator('Salvo', 'ok')
    } catch (e) {
      console.error('[saveCaseFields]', e)
      setSaveIndicator('Erro ao salvar', 'err')
    }
  }
  updateAgendaBadge()
  if (opts.immediate) return flush()
  _timers[caseId] = setTimeout(flush, 700)
  return Promise.resolve()
}

/** Define a ação em foco e carrega os dados dela (linha do tempo, roteiros, oitiva…). */
function setSelectedCase(c) {
  const prev = state.selectedCase
  const scratch = (!prev && state.timeline?.length) ? state.timeline : null
  state.selectedCase = c || null
  state.timeline = clone(c?.timeline) || []
  state.insured = clone(c?.insured) || {}
  state.scripts = (clone(c?.scripts) || []).map(s => (s.id ? s : { ...s, id: uid('sc') }))
  state.hearing = clone(c?.hearing) || {}
  state.reportsHistory = clone(c?.reports) || []
  state.reportContent = null
  state.scriptData = state.scripts[state.scripts.length - 1] || null
  state.activeQuestionIdx = 0
  state.tlEditId = null
  if (c && scratch && !state.timeline.length) {
    state.timeline = scratch
    saveCaseFields(c.id, { timeline: state.timeline })
  }
}

const CASE_PAGES = ['timeline', 'script', 'hearing-mode', 'video', 'reports', 'agenda']

async function ensureCasesLoaded(page) {
  if (state.casesLoaded) return
  state.casesLoaded = true
  try {
    const fetched = await getCases()
    const local = state.cases.filter(c => String(c.id).startsWith('local-'))
    const selId = state.selectedCase?.id
    state.cases = [...local, ...fetched.filter(c => !local.find(l => l.id === c.id))]
    if (selId) state.cases = state.cases.map(c => (c.id === selId ? state.selectedCase : c))
  } catch (e) { console.error(e) }
  updateAgendaBadge()
  if (page && state.currentPage === page) renderPage(page)
}

function caseBar() {
  const c = state.selectedCase
  const opts = state.cases.map(x =>
    `<option value="${esc(x.id)}" ${c?.id === x.id ? 'selected' : ''}>${esc(x.title || 'Sem título')}${x.clientName ? ' — ' + esc(x.clientName) : ''}</option>`
  ).join('')
  return `
    <div class="lx-casebar">
      <div class="lx-casebar-label">Ação em foco</div>
      <select class="lx-casebar-select" onchange="pickCase(this.value)" aria-label="Selecionar ação">
        <option value="" ${!c ? 'selected' : ''}>${state.cases.length ? 'Selecione uma ação…' : (state.casesLoaded ? 'Nenhuma ação cadastrada' : 'Carregando ações…')}</option>
        ${opts}
      </select>
      <span id="lx-save-state" class="lx-save-state"></span>
      <button class="btn btn-ghost btn-sm" onclick="navigate('new-case',null)">+ Nova ação</button>
    </div>
    ${!c ? `<div class="alert-warn">Escolha uma ação acima para que tudo o que você preencher fique salvo nela. Sem ação escolhida, você trabalha em rascunho e nada é gravado.</div>` : ''}`
}

window.pickCase = function (id) {
  setSelectedCase(state.cases.find(x => x.id === id) || null)
  renderPage(state.currentPage)
  updateHeader(state.currentPage)
}

// ─── PÁGINA DE INSTRUÇÃO (Linha do Tempo → Roteiro → Modo Audiência) ──
// Fluxo: 1) Linha do Tempo contributiva → 2) Roteiro por depoente → 3) Modo Audiência

if (!state.timeline) state.timeline = []            // [{id, empresa, cargo, inicio, fim, regime, categoria, prova, obs}]
if (!state.insured) state.insured = {}              // {sexo, nascimento, der}
if (!state.scripts) state.scripts = []              // roteiros (um por depoente)
if (!state.hearing) state.hearing = {}              // anotações da oitiva, por roteiro
if (!state.reportsHistory) state.reportsHistory = []
if (!state.scriptTab) state.scriptTab = 'timeline'  // 'timeline' | 'form' | 'hearing'
if (!state.activeQuestionIdx) state.activeQuestionIdx = 0

const TAB_TO_PAGE = { timeline: 'timeline', form: 'script', hearing: 'hearing-mode' }

function renderScript() {
  const tab = state.scriptTab || 'timeline'
  const hasScript = state.scripts.length > 0
  const hasTimeline = state.timeline.length > 0

  set('main-content', `
    ${caseBar()}
    <div class="ic-tabs">
      <button class="ic-tab ${tab === 'timeline' ? 'active' : ''}" onclick="switchScriptTab('timeline')">
        1 · Linha do Tempo (CNIS)
        ${hasTimeline ? `<span class="ic-tab-badge">${state.timeline.length}</span>` : ''}
      </button>
      <button class="ic-tab ${tab === 'form' ? 'active' : ''}" onclick="switchScriptTab('form')">
        2 · Roteiro Estratégico
        ${hasScript ? `<span class="ic-tab-badge">${state.scripts.length}</span>` : ''}
      </button>
      <button class="ic-tab ${tab === 'hearing' ? 'active' : ''}" onclick="switchScriptTab('hearing')">
        3 · Modo Audiência
      </button>
    </div>

    <div id="script-tab-content" class="fade-in">
      ${tab === 'timeline' ? renderTimelineTab() : tab === 'form' ? renderScriptFormTab() : renderHearingTab()}
    </div>
  `)
  if (tab === 'form' && state.scriptData) renderScriptResult(state.scriptData)
  if (tab === 'timeline') refreshTimelineAnalysis()
  if (tab === 'hearing') afterHearingRender()
}

window.switchScriptTab = function (tab) {
  state.scriptTab = tab
  state.currentPage = TAB_TO_PAGE[tab] || state.currentPage
  syncNav(state.currentPage)
  updateHeader(state.currentPage)
  renderScript()
}

// ── TAB 1: LINHA DO TEMPO ─────────────────────────────────────────

const REGIME_COLOR = {
  empregado: 'var(--accent-blue)', especial: 'var(--risk-high)', rural: 'var(--risk-low)',
  individual: 'var(--accent-gold)', domestico: 'var(--accent-teal)', avulso: 'var(--accent-teal)',
  facultativo: 'var(--risk-med)', rpps: 'var(--accent-gold)', outro: 'var(--text-muted)',
}
const REGIME_LABEL = {
  empregado: 'EMPREGADO', especial: 'ESPECIAL', rural: 'RURAL', individual: 'CONTRIB. INDIVIDUAL',
  domestico: 'DOMÉSTICO', avulso: 'AVULSO', facultativo: 'FACULTATIVO', rpps: 'RPPS', outro: 'OUTRO',
}
const PROVA_LABEL = {
  cnis: 'Consta no CNIS', ctps: 'CTPS', ppp: 'PPP / LTCAT', documento: 'Outro documento',
  testemunhal: 'Só prova testemunhal', nenhuma: 'Sem prova ainda',
}
// Regimes que contam como tempo de contribuição (rural sem contribuição fica de fora)
const CONTRIB_REGIMES = ['empregado', 'especial', 'individual', 'domestico', 'avulso', 'facultativo', 'rpps']
// Conversão de tempo especial em comum (Decreto 3.048/99, art. 70): fator por categoria e sexo
const ESPECIAL_FACTOR = { 25: { M: 1.4, F: 1.2 }, 20: { M: 1.75, F: 1.5 }, 15: { M: 2.33, F: 2.0 } }
const EC103_IDX = 2019 * 12 + 10 // nov/2019: a conversão só vale para o tempo anterior à EC 103/2019

const mIdx = ym => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1) }
const idxToYM = i => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
const nowIdx = () => { const d = new Date(); return d.getFullYear() * 12 + d.getMonth() }

function fmtMonth(ym) {
  if (!ym) return '—'
  const [y, m] = ym.split('-')
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${months[parseInt(m) - 1]}/${y}`
}

function fmtMonthsSpan(n) {
  n = Math.round(n)
  if (n <= 0) return '0 meses'
  if (n < 12) return `${n} ${n === 1 ? 'mês' : 'meses'}`
  const y = Math.floor(n / 12), r = n % 12
  return `${y} ${y === 1 ? 'ano' : 'anos'}${r ? ` e ${r} ${r === 1 ? 'mês' : 'meses'}` : ''}`
}

// Duração inclusiva: o mês de início e o mês de fim contam como meses cheios
function calcDuracao(inicio, fim) {
  if (!inicio) return ''
  const s = mIdx(inicio), e = fim ? mIdx(fim) : nowIdx()
  if (e < s) return 'datas inválidas'
  return fmtMonthsSpan(e - s + 1)
}

/** Analisa a linha do tempo: tempo somado sem duplicar concomitâncias, lacunas, conversão de especial e alertas. */
function analyzeTimeline() {
  const sex = state.insured?.sexo
  const today = nowIdx()
  const out = {
    rows: [], rawMonths: 0, contribMonths: 0, before: 0, after: 0, ruralMonths: 0, especialExtra: 0,
    gaps: [], overlaps: [], alerts: [], firstIdx: null, lastIdx: null,
  }
  const rows = []
  for (const p of state.timeline || []) {
    if (!p.inicio) continue
    const s = mIdx(p.inicio), e = p.fim ? mIdx(p.fim) : today
    if (e < s) { out.alerts.push({ level: 'high', text: `${p.empresa}: a data de fim é anterior à de início.` }); continue }
    rows.push({ ...p, s, e })
  }
  out.rows = rows
  if (!rows.length) return out
  const min = Math.min(...rows.map(r => r.s)), max = Math.max(...rows.map(r => r.e))
  out.firstIdx = min; out.lastIdx = max

  let gapStart = null
  for (let m = min; m <= max; m++) {
    const cov = rows.filter(r => r.s <= m && r.e >= m)
    if (!cov.length) { if (gapStart === null) gapStart = m; continue }
    if (gapStart !== null) { out.gaps.push({ from: gapStart, to: m - 1 }); gapStart = null }
    const contrib = cov.filter(r => CONTRIB_REGIMES.includes(r.regime))
    if (contrib.length) {
      let w = 1
      if (m < EC103_IDX && sex) {
        const special = contrib.filter(r => r.regime === 'especial')
        if (special.length) w = Math.max(1, ...special.map(r => ESPECIAL_FACTOR[r.categoria || 25]?.[sex] || 1))
      }
      out.rawMonths += 1
      out.contribMonths += w
      out.especialExtra += (w - 1)
      if (m < EC103_IDX) out.before += w; else out.after += w
    }
    if (cov.some(r => r.regime === 'rural')) out.ruralMonths += 1
  }

  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j]
    const from = Math.max(a.s, b.s), to = Math.min(a.e, b.e)
    if (to >= from) out.overlaps.push({ a: a.empresa, b: b.empresa, from, to })
  }

  // Alertas de prova
  for (const r of rows) {
    const nome = `${r.empresa} (${fmtMonth(r.inicio)}–${r.fim ? fmtMonth(r.fim) : 'atual'})`
    const fraca = r.prova === 'nenhuma' || r.prova === 'testemunhal'
    if (r.regime === 'rural' && fraca) out.alerts.push({ level: 'high', text: `${nome}: rural sem início de prova material — só a prova testemunhal não basta (Súmula 149/STJ).` })
    else if (r.prova === 'nenhuma') out.alerts.push({ level: 'high', text: `${nome}: sem prova documental cadastrada.` })
    else if (r.prova === 'testemunhal') out.alerts.push({ level: 'med', text: `${nome}: depende só de prova testemunhal — priorize no roteiro.` })
    if (r.regime === 'especial' && r.prova && r.prova !== 'ppp') out.alerts.push({ level: 'med', text: `${nome}: atividade especial sem PPP/LTCAT anexado.` })
  }
  if (rows.some(r => r.regime === 'especial') && !sex) out.alerts.push({ level: 'med', text: 'Informe o sexo do(a) segurado(a) para converter o tempo especial em comum.' })
  for (const g of out.gaps) out.alerts.push({ level: 'med', text: `Lacuna de ${fmtMonthsSpan(g.to - g.from + 1)} entre ${fmtMonth(idxToYM(g.from))} e ${fmtMonth(idxToYM(g.to))}: pergunte o que ocorreu.` })
  return out
}

function parseYMD(s) { return s ? new Date(s + 'T00:00:00') : null }

/** Idade em meses na data de referência. */
function ageMonthsAt(birth, ref) {
  const b = parseYMD(birth), r = parseYMD(ref)
  if (!b || !r) return null
  let n = (r.getFullYear() - b.getFullYear()) * 12 + (r.getMonth() - b.getMonth())
  if (r.getDate() < b.getDate()) n -= 1
  return n
}

/**
 * Simulação de apoio dos requisitos da EC 103/2019 (regra por idade e regra de pontos).
 * NÃO cobre as regras de transição por pedágio nem idade mínima progressiva.
 */
function simulateRequirements(a) {
  const ins = state.insured || {}
  const c = state.selectedCase
  const ref = ins.der || c?.der || todayISO()
  if (!ins.nascimento || !ins.sexo || !a.rows.length) return null
  const ageM = ageMonthsAt(ins.nascimento, ref)
  if (ageM === null || ageM < 0) return null
  const F = ins.sexo === 'F'
  const year = parseInt(ref.slice(0, 4))
  const ageTxt = `${Math.floor(ageM / 12)}a ${ageM % 12}m`
  const filiadoAntes = a.firstIdx < EC103_IDX
  if (ref < '2019-11-13') return { ref, ageTxt, filiadoAntes, items: [], note: 'DER anterior à EC 103/2019: aplicam-se as regras anteriores, que esta simulação não cobre.' }

  const items = []
  // Regra por idade
  const reqAge = F ? (filiadoAntes ? Math.min(62, 60 + 0.5 * Math.max(0, year - 2019)) : 62) : 65
  const reqYears = F ? 15 : (filiadoAntes ? 15 : 20)
  const okAge = ageM >= reqAge * 12, okTc = a.rawMonths >= reqYears * 12
  items.push({
    name: 'Aposentadoria por idade',
    ok: okAge && okTc,
    detail: `Idade ${ageTxt} (mín. ${Number.isInteger(reqAge) ? reqAge : reqAge.toFixed(1)} anos) · ${a.rawMonths} meses de contribuição (mín. ${reqYears * 12})`,
  })
  // Regra de pontos
  const basePts = (F ? 86 : 96) + Math.max(0, year - 2019)
  const reqPts = Math.min(F ? 100 : 105, basePts)
  const reqTcPts = F ? 30 : 35
  const pts = ageM / 12 + a.contribMonths / 12
  const okPts = pts >= reqPts && a.contribMonths >= reqTcPts * 12
  items.push({
    name: 'Regra de pontos (transição)',
    ok: okPts && filiadoAntes,
    detail: `${pts.toFixed(2)} pontos (mín. ${reqPts}) · ${fmtMonthsSpan(a.contribMonths)} de contribuição (mín. ${reqTcPts} anos)${filiadoAntes ? '' : ' · só vale para quem já era filiado em 13/11/2019'}`,
  })
  return { ref, ageTxt, filiadoAntes, items }
}

function timelineContextText() {
  if (!state.timeline.length) return ''
  const a = analyzeTimeline()
  const linhas = state.timeline.map(p =>
    `- ${p.empresa} | ${p.cargo} | ${fmtMonth(p.inicio)}–${p.fim ? fmtMonth(p.fim) : 'atual'} | ${REGIME_LABEL[p.regime] || p.regime}${p.prova ? ' | Prova: ' + (PROVA_LABEL[p.prova] || p.prova) : ''}${p.obs ? ' | Obs: ' + p.obs : ''}`)
  const gaps = a.gaps.map(g => `${fmtMonth(idxToYM(g.from))}–${fmtMonth(idxToYM(g.to))}`)
  const fracos = a.alerts.filter(x => /prova|PPP/.test(x.text)).map(x => x.text)
  return `LINHA DO TEMPO CONTRIBUTIVA:\n${linhas.join('\n')}` +
    (gaps.length ? `\nLacunas sem vínculo: ${gaps.join('; ')}` : '') +
    (fracos.length ? `\nPontos frágeis de prova: ${fracos.join(' ')}` : '')
}

function persistTimeline() {
  if (state.selectedCase) saveCaseFields(state.selectedCase.id, { timeline: state.timeline, insured: state.insured })
}

function renderTimelineTab() {
  const periods = state.timeline
  const editing = state.tlEditId ? periods.find(p => p.id === state.tlEditId) : null
  const v = editing || {}
  const ins = state.insured || {}
  const der = ins.der || state.selectedCase?.der || ''
  const sel = (cur, val) => (cur === val ? 'selected' : '')
  const dateStyle = 'background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-md);border-radius:var(--radius-sm);padding:8px 12px;font-family:inherit;width:100%'

  return `
    <div style="max-width:900px">
      <div style="margin-bottom:20px">
        <div style="font-size:15px;font-weight:600;margin-bottom:4px">Linha do Tempo Contributiva</div>
        <div style="font-size:13px;color:var(--text-muted)">Cadastre os vínculos conforme CNIS, CTPS, PPP e demais documentos. O sistema soma o tempo sem duplicar concomitâncias, aponta lacunas e pontos fracos de prova, e leva tudo isso para o roteiro da oitiva.</div>
      </div>

      <div class="card" style="padding:18px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px">Dados do(a) segurado(a) para o cálculo</div>
        <div class="grid-3" style="gap:12px">
          <div class="field"><label>Sexo</label>
            <select id="ins-sexo" onchange="saveInsured()">
              <option value="" ${sel(ins.sexo, undefined)}>Selecione…</option>
              <option value="F" ${sel(ins.sexo, 'F')}>Feminino</option>
              <option value="M" ${sel(ins.sexo, 'M')}>Masculino</option>
            </select>
          </div>
          <div class="field"><label>Data de nascimento</label><input type="date" id="ins-nasc" value="${esc(ins.nascimento || '')}" onchange="saveInsured()" style="${dateStyle}" /></div>
          <div class="field"><label>DER (ou data de referência)</label><input type="date" id="ins-der" value="${esc(der)}" onchange="saveInsured()" style="${dateStyle}" /></div>
        </div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:20px;border:1px solid var(--accent-blue-border)">
        <div style="font-size:13px;font-weight:600;margin-bottom:14px;color:var(--accent-blue)">${editing ? 'Editar período' : '+ Adicionar período'}</div>
        <div class="grid-2" style="gap:12px;margin-bottom:12px">
          <div class="field"><label>Empregador / Fonte de custeio *</label><input type="text" id="tl-empresa" value="${esc(v.empresa || '')}" placeholder="Ex.: Usina São João Ltda. / Contribuinte individual" /></div>
          <div class="field"><label>Cargo / Atividade *</label><input type="text" id="tl-cargo" value="${esc(v.cargo || '')}" placeholder="Ex.: Cortador de cana, soldador, lavrador" /></div>
        </div>
        <div class="grid-2" style="gap:12px;margin-bottom:12px">
          <div class="field"><label>Início *</label><input type="month" id="tl-inicio" value="${esc(v.inicio || '')}" style="${dateStyle}" /></div>
          <div class="field"><label>Fim (vazio = atual)</label><input type="month" id="tl-fim" value="${esc(v.fim || '')}" style="${dateStyle}" /></div>
        </div>
        <div class="grid-2" style="gap:12px;margin-bottom:12px">
          <div class="field"><label>Enquadramento Previdenciário</label>
            <select id="tl-regime" onchange="tlRegimeChange()">
              ${[['empregado', 'Empregado (RGPS)'], ['especial', 'Atividade Especial (agente nocivo)'], ['rural', 'Segurado Especial / Rural'], ['individual', 'Contribuinte Individual'], ['domestico', 'Empregado Doméstico'], ['avulso', 'Trabalhador Avulso'], ['facultativo', 'Facultativo'], ['rpps', 'Servidor (RPPS)'], ['outro', 'Outro']]
                .map(([val, lbl]) => `<option value="${val}" ${sel(v.regime || 'empregado', val)}>${lbl}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Como esse período está provado?</label>
            <select id="tl-prova">
              ${Object.entries(PROVA_LABEL).map(([val, lbl]) => `<option value="${val}" ${sel(v.prova || 'cnis', val)}>${lbl}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid-2" style="gap:12px;margin-bottom:14px">
          <div class="field" id="tl-cat-wrap" style="display:${v.regime === 'especial' ? 'flex' : 'none'}"><label>Categoria da atividade especial</label>
            <select id="tl-cat">
              <option value="25" ${sel(String(v.categoria || 25), '25')}>25 anos (a maioria: ruído, químicos…)</option>
              <option value="20" ${sel(String(v.categoria), '20')}>20 anos</option>
              <option value="15" ${sel(String(v.categoria), '15')}>15 anos (subsolo)</option>
            </select>
          </div>
          <div class="field"><label>Observação (opcional)</label><input type="text" id="tl-obs" value="${esc(v.obs || '')}" placeholder="Ex.: sem registro no CNIS, PPP com ruído 92 dB…" /></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="addTimelinePeriod()">${editing ? 'Salvar alterações' : 'Adicionar à Linha do Tempo'}</button>
          ${editing ? `<button class="btn btn-ghost btn-sm" onclick="cancelEditPeriod()">Cancelar</button>` : ''}
        </div>
      </div>

      ${periods.length === 0 ? `
        <div class="empty-state card" style="padding:40px">
          <div class="empty-icon">📅</div>
          <div class="empty-title">Nenhum período cadastrado ainda</div>
          <div class="empty-desc">Adicione acima os períodos de trabalho e contribuição do(a) segurado(a).</div>
        </div>
      ` : `
        <div id="tl-analysis"></div>
        <div style="margin:18px 0 8px;display:flex;align-items:center;justify-content:space-between">
          <span class="section-muted">${periods.length} período${periods.length > 1 ? 's' : ''} cadastrado${periods.length > 1 ? 's' : ''}</span>
          <button class="btn btn-ghost btn-sm" onclick="clearTimeline()">Limpar tudo</button>
        </div>
        <div class="tl-visual">
          ${periods.map((p, i) => renderTimelineCard(p, i)).join('')}
        </div>
      `}

      <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" onclick="switchScriptTab('form')">Montar roteiro de oitiva →</button>
        ${periods.length > 0 ? `<span style="font-size:12px;color:var(--text-muted)">Lacunas e pontos frágeis de prova vão para o roteiro automaticamente.</span>` : ''}
      </div>
    </div>`
}

function renderGantt(a) {
  if (!a.rows.length) return ''
  const min = a.firstIdx, max = a.lastIdx
  const span = Math.max(1, max - min + 1)
  const pos = i => ((i - min) / span) * 100
  const y0 = Math.floor(min / 12) + 1, y1 = Math.floor(max / 12)
  const step = Math.max(1, Math.ceil((y1 - y0 + 1) / 8))
  const ticks = []
  for (let y = y0; y <= y1; y += step) ticks.push(`<span class="lx-gantt-tick" style="left:${pos(y * 12)}%">${y}</span>`)
  const gaps = a.gaps.map(g => `<div class="lx-gantt-gap" style="left:${pos(g.from)}%;width:${Math.max(0.8, ((g.to - g.from + 1) / span) * 100)}%" title="Lacuna: ${fmtMonth(idxToYM(g.from))} a ${fmtMonth(idxToYM(g.to))}"></div>`).join('')
  const bars = a.rows.map(r => {
    const color = REGIME_COLOR[r.regime] || 'var(--text-muted)'
    return `<div class="lx-gantt-row">
      <div class="lx-gantt-label" title="${esc(r.empresa)}">${esc(r.empresa)}</div>
      <div class="lx-gantt-track"><div class="lx-gantt-bar" style="left:${pos(r.s)}%;width:${Math.max(0.8, ((r.e - r.s + 1) / span) * 100)}%;background:${color}" title="${esc(r.empresa)} · ${fmtMonth(idxToYM(r.s))} a ${fmtMonth(idxToYM(r.e))}"></div></div>
    </div>`
  }).join('')
  return `
    <div class="lx-gantt">
      <div class="lx-gantt-row lx-gantt-axis"><div class="lx-gantt-label"></div><div class="lx-gantt-track">${ticks.join('')}</div></div>
      ${bars}
      ${a.gaps.length ? `<div class="lx-gantt-row"><div class="lx-gantt-label" style="color:var(--risk-med)">Lacunas</div><div class="lx-gantt-track">${gaps}</div></div>` : ''}
    </div>`
}

function renderTimelineAnalysis() {
  const a = analyzeTimeline()
  if (!a.rows.length) return ''
  const sim = simulateRequirements(a)
  const stat = (label, value, sub) => `
    <div class="lx-stat"><div class="lx-stat-label">${label}</div><div class="lx-stat-value">${value}</div>${sub ? `<div class="lx-stat-sub">${sub}</div>` : ''}</div>`
  const alerts = a.alerts.slice(0, 12)
  return `
    <div class="card" style="padding:18px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <div style="font-size:13px;font-weight:600">Análise da linha do tempo</div>
        <span style="font-size:11px;color:var(--text-muted)">Estimativa por mês cheio — sem cálculo de dias</span>
      </div>
      ${renderGantt(a)}
      <div class="lx-stat-grid">
        ${stat('Tempo de contribuição', fmtMonthsSpan(a.contribMonths), a.especialExtra > 0.4 ? `inclui +${fmtMonthsSpan(a.especialExtra)} de conversão do especial` : 'concomitâncias não são somadas duas vezes')}
        ${stat('Até out/2019', fmtMonthsSpan(a.before), 'antes da EC 103/2019')}
        ${stat('A partir de nov/2019', fmtMonthsSpan(a.after), 'após a EC 103/2019')}
        ${stat('Atividade rural', fmtMonthsSpan(a.ruralMonths), 'não conta como contribuição sem indenização')}
      </div>
      ${a.overlaps.length ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:12px"><strong>Concomitâncias:</strong> ${a.overlaps.slice(0, 5).map(o => `${esc(o.a)} × ${esc(o.b)} (${fmtMonth(idxToYM(o.from))}–${fmtMonth(idxToYM(o.to))})`).join('; ')}</div>` : ''}
    </div>
    ${alerts.length ? `
      <div class="card" style="padding:18px;margin-bottom:14px">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px">Pontos de atenção (${a.alerts.length})</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${alerts.map(x => `<div class="lx-alert-row ${x.level}"><span class="lx-alert-dot"></span><span>${esc(x.text)}</span></div>`).join('')}
        </div>
      </div>` : ''}
    <div class="card" style="padding:18px">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px">Simulação de requisitos (apoio)</div>
      ${sim
        ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Referência: ${fmtBR(sim.ref)} · idade ${sim.ageTxt} · ${sim.filiadoAntes ? 'filiado(a) antes da EC 103/2019' : 'filiado(a) após a EC 103/2019'}</div>
           ${sim.note ? `<div class="alert-warn" style="margin:0">${esc(sim.note)}</div>` : sim.items.map(it => `
             <div class="lx-req-row"><span class="badge ${it.ok ? 'badge-risk-low' : 'badge-risk-med'}">${it.ok ? 'Atende' : 'Não atende'}</span>
               <div><div style="font-size:13px;font-weight:500">${it.name}</div><div style="font-size:12px;color:var(--text-muted)">${esc(it.detail)}</div></div></div>`).join('')}
           <div style="font-size:11px;color:var(--text-muted);margin-top:10px;line-height:1.5">Simulação de apoio: não inclui as regras de transição por pedágio nem idade mínima progressiva, e não substitui o cálculo oficial. Confira sempre a regra aplicável ao caso.</div>`
        : `<div style="font-size:12px;color:var(--text-muted)">Informe sexo e data de nascimento acima para simular a regra por idade e a regra de pontos.</div>`}
    </div>`
}

function refreshTimelineAnalysis() {
  const box = el('tl-analysis')
  if (box) box.innerHTML = renderTimelineAnalysis()
}

window.saveInsured = function () {
  state.insured = {
    sexo: el('ins-sexo')?.value || '',
    nascimento: el('ins-nasc')?.value || '',
    der: el('ins-der')?.value || '',
  }
  persistTimeline()
  refreshTimelineAnalysis()
}

window.tlRegimeChange = function () {
  const w = el('tl-cat-wrap')
  if (w) w.style.display = el('tl-regime')?.value === 'especial' ? 'flex' : 'none'
}

function renderTimelineCard(p, i) {
  const color = REGIME_COLOR[p.regime] || 'var(--text-muted)'
  const label = REGIME_LABEL[p.regime] || (p.regime || '').toUpperCase()
  const duracao = calcDuracao(p.inicio, p.fim)
  return `
    <div class="tl-card fade-up" style="animation-delay:${i * 0.05}s;border-left-color:${color}">
      <div class="tl-card-line" style="background:${color}"></div>
      <div class="tl-card-dot" style="background:${color}"></div>
      <div class="tl-card-body">
        <div class="tl-card-header">
          <div>
            <div style="font-size:14px;font-weight:600">${esc(p.empresa)}</div>
            <div style="font-size:12px;color:var(--text-secondary)">${esc(p.cargo)}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <span class="badge" style="background:${color}18;color:${color};border:1px solid ${color}44">${label}${p.regime === 'especial' ? ' ' + (p.categoria || 25) + 'a' : ''}</span>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${duracao}</div>
          </div>
        </div>
        <div class="tl-card-dates">
          ${fmtMonth(p.inicio)} → ${p.fim ? fmtMonth(p.fim) : '<span style="color:var(--risk-low)">Atual</span>'}
          ${p.prova ? `<span class="badge ${p.prova === 'nenhuma' ? 'badge-risk-high' : p.prova === 'testemunhal' ? 'badge-risk-med' : 'badge-neutral'}" style="margin-left:8px">${PROVA_LABEL[p.prova] || p.prova}</span>` : ''}
          ${p.obs ? `<span style="margin-left:10px;color:var(--text-muted)">· ${esc(p.obs)}</span>` : ''}
        </div>
        <div style="display:flex;gap:4px;margin-top:6px">
          <button class="btn btn-ghost btn-sm" onclick="editTimelinePeriod(${i})">Editar</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--risk-high)" onclick="removeTimelinePeriod(${i})">Remover</button>
        </div>
      </div>
    </div>`
}

window.addTimelinePeriod = function () {
  const empresa = el('tl-empresa')?.value.trim()
  const cargo = el('tl-cargo')?.value.trim()
  const inicio = el('tl-inicio')?.value
  const fim = el('tl-fim')?.value || null
  if (!empresa || !cargo || !inicio) { alert('Preencha empregador, atividade e data de início.'); return }
  if (fim && fim < inicio) { alert('A data de fim não pode ser anterior à de início.'); return }
  const regime = el('tl-regime')?.value || 'empregado'
  const period = {
    id: state.tlEditId || uid('tl'),
    empresa, cargo, inicio, fim, regime,
    categoria: regime === 'especial' ? parseInt(el('tl-cat')?.value || '25') : null,
    prova: el('tl-prova')?.value || 'cnis',
    obs: el('tl-obs')?.value.trim() || '',
  }
  if (state.tlEditId) state.timeline = state.timeline.map(p => (p.id === state.tlEditId ? period : p))
  else state.timeline.push(period)
  state.tlEditId = null
  state.timeline.sort((a, b) => a.inicio.localeCompare(b.inicio))
  persistTimeline()
  renderScript()
}

window.editTimelinePeriod = function (idx) {
  state.tlEditId = state.timeline[idx]?.id || null
  renderScript()
  el('tl-empresa')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

window.cancelEditPeriod = function () { state.tlEditId = null; renderScript() }

window.removeTimelinePeriod = function (idx) {
  state.timeline.splice(idx, 1)
  state.tlEditId = null
  persistTimeline()
  renderScript()
}

window.clearTimeline = function () {
  if (!confirm('Remover todos os períodos?')) return
  state.timeline = []
  state.tlEditId = null
  persistTimeline()
  renderScript()
}

// ── TAB 2: CONFIGURAR ROTEIRO ─────────────────────────────────────

function renderScriptFormTab() {
  const c = state.selectedCase
  const hasTimeline = state.timeline.length > 0
  const tlSummary = hasTimeline
    ? state.timeline.map(p => `${p.empresa} (${p.cargo}, ${fmtMonth(p.inicio)}–${p.fim?fmtMonth(p.fim):'atual'}, ${REGIME_LABEL[p.regime]||p.regime}${p.obs?' — '+p.obs:''})`).join('; ')
    : ''

  return `
    <div class="grid-auto" style="align-items:start">
      <div>
        ${hasTimeline ? `
          <div class="alert-info" style="margin-bottom:16px;display:flex;align-items:flex-start;gap:10px">
            <span style="font-size:16px;flex-shrink:0">📅</span>
            <div>
              <div style="font-weight:600;margin-bottom:4px">Linha do tempo ativa</div>
              <div style="font-size:12px;color:var(--text-secondary);line-height:1.5">${state.timeline.length} período${state.timeline.length>1?'s':''} contributivo${state.timeline.length>1?'s':''} influenciarão o roteiro automaticamente.</div>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="switchScriptTab('timeline')" style="margin-left:auto;flex-shrink:0">Editar</button>
          </div>` : `
          <div class="alert-warn" style="margin-bottom:16px">
            ⚠ Nenhum período cadastrado. <button class="btn btn-ghost btn-sm" onclick="switchScriptTab('timeline')" style="padding:2px 8px">Adicionar →</button>
          </div>`}

        <div class="card" style="padding:22px;margin-bottom:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:18px">Configurar Roteiro Estratégico</div>
          <div style="display:flex;flex-direction:column;gap:14px">
            <div class="field">
              <label>Nome do(a) Depoente / Segurado(a) *</label>
              <input type="text" id="script-witness" value="${esc(state.selectedCase?.clientName || '')}" placeholder="Ex.: João da Silva" />
            </div>
            <div class="grid-2" style="gap:12px">
              <div class="field">
                <label>Papel na Audiência</label>
                <select id="script-role">
                  <option value="segurado">Segurado(a) / Parte autora</option>
                  <option value="testemunha-autor">Testemunha da parte autora</option>
                  <option value="testemunha-inss">Testemunha do INSS</option>
                  <option value="perito-medico">Perito médico judicial</option>
                  <option value="perito-social">Perito socioeconômico</option>
                  <option value="procurador-inss">Procurador do INSS</option>
                </select>
              </div>
              <div class="field">
                <label>Benefício em Discussão</label>
                <select id="script-action-type">
                  <option value="aposentadoria-rural">Aposentadoria Rural / Segurado Especial</option>
                  <option value="aposentadoria-especial">Aposentadoria Especial</option>
                  <option value="aposentadoria-tempo">Aposentadoria por Tempo de Contribuição</option>
                  <option value="aposentadoria-idade">Aposentadoria por Idade</option>
                  <option value="incapacidade">Auxílio por Incapacidade Temporária</option>
                  <option value="invalidez">Aposentadoria por Incapacidade Permanente</option>
                  <option value="bpc">BPC / LOAS</option>
                  <option value="pensao">Pensão por Morte</option>
                  <option value="maternidade">Salário-Maternidade</option>
                  <option value="acidente">Auxílio-Acidente</option>
                  <option value="revisao">Revisão de Benefício</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label>Temas prioritários</label>
              <div class="ic-checkgroup">
                ${[
                  ['rural','Labor rural em regime de economia familiar'],
                  ['especial','Exposição a agentes nocivos (especial)'],
                  ['qualidade','Qualidade de segurado, carência e período de graça'],
                  ['incapacidade','Incapacidade laborativa e limitações'],
                  ['dependencia','Dependência econômica / união estável'],
                  ['miserabilidade','Miserabilidade e grupo familiar (BPC)'],
                  ['provamaterial','Início de prova material'],
                  ['contradictions','Contradições e inconsistências'],
                  ['testemunho','Credibilidade do testemunho'],
                ].map(([val,lbl]) => `
                  <label class="ic-check-item">
                    <input type="checkbox" id="focus-${val}" ${['rural','provamaterial','contradictions'].includes(val)?'checked':''} />
                    <span>${lbl}</span>
                  </label>`).join('')}
              </div>
            </div>
            <div class="field">
              <label>Contexto adicional do caso (opcional)</label>
              <textarea id="script-context" placeholder="Ex.: CNIS com lacuna entre 1998 e 2004; PPP indica ruído de 92 dB; declaração do sindicato rural de 1996; indeferimento por falta de início de prova material…" style="min-height:80px"></textarea>
            </div>
            <button class="btn btn-primary btn-lg" id="script-gen-btn" onclick="handleGenerateScript()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2a2 2 0 0 1 2 2v.5a.5.5 0 0 0 .5.5H16a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-1.5a.5.5 0 0 0-.5.5V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="15" r="3" stroke="currentColor" stroke-width="1.5"/></svg>
              Gerar Roteiro Estratégico com IA
            </button>
          </div>
        </div>
        <div id="script-output"></div>
      </div>

      <!-- Coluna lateral: dicas + resumo da linha do tempo -->
      <div style="display:flex;flex-direction:column;gap:14px">
        ${hasTimeline ? `
          <div class="card" style="padding:18px">
            <div class="section-muted" style="margin-bottom:12px">Períodos Cadastrados</div>
            ${state.timeline.map(p => `
              <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);align-items:center">
                <div style="width:8px;height:8px;border-radius:50%;background:var(--accent-blue);flex-shrink:0;margin-top:3px"></div>
                <div>
                  <div style="font-size:12px;font-weight:500">${p.empresa}</div>
                  <div style="font-size:11px;color:var(--text-muted)">${p.cargo} · ${fmtMonth(p.inicio)}–${p.fim?fmtMonth(p.fim):'atual'}</div>
                </div>
              </div>`).join('')}
          </div>` : ''}

        <div class="card" style="padding:18px">
          <div class="section-muted" style="margin-bottom:12px">Dicas Estratégicas</div>
          <div style="display:flex;flex-direction:column;gap:9px;font-size:12px;color:var(--text-secondary)">
            ${[
              'A prova testemunhal corrobora — não substitui — o início de prova material.',
              'Pergunte desde quando a testemunha conhece o(a) segurado(a) e como sabe do período.',
              'Rural: safra, cultura, tamanho da terra, ferramentas, escola dos filhos e vizinhança.',
              'Especial: habitualidade, permanência, agente nocivo e eficácia real do EPI.',
              'Incapacidade: rotina diária, esforço exigido e tentativas de retorno ao trabalho.',
              'Pensão e BPC: convivência, despesas e renda do grupo familiar.',
              'Confronte o depoimento com o CNIS — divergência de datas é ponto crítico.',
              'Reserve as contradições para o final: não antecipe a linha de ataque.',
            ].map(t => `<div style="display:flex;gap:8px"><span style="color:var(--accent-teal);flex-shrink:0">→</span>${t}</div>`).join('')}
          </div>
        </div>
      </div>
    </div>`
}

function persistScripts() {
  if (state.selectedCase) saveCaseFields(state.selectedCase.id, { scripts: state.scripts, hearing: state.hearing })
}

function scriptChips(mode) {
  if (mode !== 'hearing' && state.scripts.length < 2) return ''
  return `
    <div class="lx-chips">
      ${state.scripts.map(s => `<button class="lx-chip ${s.id === state.scriptData?.id ? 'active' : ''}" onclick="selectScript('${esc(s.id)}')">${esc(s.witness)}</button>`).join('')}
      ${mode === 'hearing' ? `<button class="lx-chip lx-chip-add" onclick="switchScriptTab('form')">+ Novo depoente</button>` : ''}
    </div>`
}

window.selectScript = function (id) {
  const s = state.scripts.find(x => x.id === id)
  if (!s) return
  state.scriptData = s
  state.activeQuestionIdx = 0
  if (state.scriptTab === 'hearing') renderScript()
  else renderScriptResult(s)
}

window.deleteScript = function (id) {
  const s = state.scripts.find(x => x.id === id)
  if (!s || !confirm(`Excluir o roteiro de "${s.witness}" e as anotações da oitiva dele(a)?`)) return
  state.scripts = state.scripts.filter(x => x.id !== id)
  delete state.hearing[id]
  state.scriptData = state.scripts[state.scripts.length - 1] || null
  state.activeQuestionIdx = 0
  persistScripts()
  renderScript()
}

window.handleGenerateScript = async function () {
  const witness = el('script-witness')?.value?.trim()
  if (!witness) { alert('Informe o nome do(a) depoente.'); return }
  const focus = ['rural', 'especial', 'qualidade', 'incapacidade', 'dependencia', 'miserabilidade', 'provamaterial', 'contradictions', 'testemunho'].filter(f => el('focus-' + f)?.checked)
  const role = el('script-role')?.value || 'segurado'
  const actionType = el('script-action-type')?.value || 'aposentadoria-rural'
  const context = el('script-context')?.value || ''
  const c = state.selectedCase
  const timelineCtx = timelineContextText()

  const btn = el('script-gen-btn')
  const original = btn.innerHTML
  btn.disabled = true; btn.innerHTML = `${spinner()} Gerando roteiro estratégico…`
  set('script-output', `<div style="text-align:center;padding:48px">${spinner('spinner-lg')}<div style="font-size:13px;color:var(--text-muted);margin-top:16px">A IA está analisando a linha do tempo e montando o roteiro…</div></div>`)

  try {
    const caseCtx = c ? `Caso: ${c.title}. Segurado(a): ${c.clientName || ''}. Benefício: ${c.benefit || ''}. NB: ${c.nb || ''}. DER: ${c.der || ''}. Vara/Juizado: ${c.court || ''}. ` : ''
    const script = await generateScript({
      witness, witnessRole: role, focus, actionType,
      caseContext: caseCtx + context + (timelineCtx ? '\n\n' + timelineCtx : ''),
    })
    script.id = uid('sc')
    script.role = role
    script.witness = witness
    script.questions = (script.questions || []).map((q, i) => ({ ...q, id: i + 1 }))
    state.scripts.push(script)
    state.scriptData = script
    state.activeQuestionIdx = 0
    persistScripts()
    renderScript()
  } catch (e) {
    set('script-output', `<div class="alert-error">${esc(e.message)}</div>`)
    btn.disabled = false; btn.innerHTML = original
  }
}

function renderScriptResult(script) {
  const c = state.selectedCase
  const prioColor = { critical: 'var(--risk-high)', high: 'var(--risk-med)', normal: 'var(--text-muted)' }
  const prioLabel = { critical: 'Crítico', high: 'Alta prioridade', normal: 'Normal' }
  set('script-output', `
    <div class="fade-up">
      ${scriptChips('form')}
      <div class="card" style="padding:16px 20px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:14px;font-weight:600">${esc(script.witness)}</div>
          <div style="font-size:12px;color:var(--text-muted)">${script.questions.length} perguntas · ${esc(c?.title || 'sem ação vinculada')}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="switchScriptTab('hearing')">Conduzir oitiva →</button>
          <button class="btn btn-ghost btn-sm" onclick="exportScript()">Exportar TXT</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--risk-high)" onclick="deleteScript('${esc(script.id)}')">Excluir roteiro</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${script.questions.map((q, i) => `
          <div class="card question-card priority-${esc(q.priority)} fade-up" style="animation-delay:${i * 0.03}s">
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div class="question-num">${i + 1}</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
                  <span class="badge badge-neutral">${esc(q.category)}</span>
                  ${q.aiFlag ? '<span class="badge badge-risk-high">⚠ Contradição</span>' : ''}
                  <span style="margin-left:auto;font-size:11px;color:${prioColor[q.priority] || 'var(--text-muted)'}">${prioLabel[q.priority] || ''}</span>
                </div>
                <p style="font-size:13px;line-height:1.6;margin:0">${esc(q.text)}</p>
                ${q.rationale ? `<p style="font-size:11px;color:var(--text-muted);margin:6px 0 0;font-style:italic">${esc(q.rationale)}</p>` : ''}
              </div>
              <button class="btn btn-ghost btn-sm" title="Remover pergunta" onclick="removeQuestion(${i})" style="padding:2px 8px">✕</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="card" style="padding:14px 16px;margin-top:12px">
        <div style="font-size:12px;font-weight:600;margin-bottom:8px">Acrescentar pergunta própria</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="text" id="manual-q" placeholder="Digite a pergunta…" style="flex:1;min-width:200px" onkeydown="if(event.key==='Enter')addManualQuestion()" />
          <select id="manual-q-prio" style="width:auto"><option value="normal">Normal</option><option value="high">Alta prioridade</option><option value="critical">Crítica</option></select>
          <button class="btn btn-secondary btn-sm" onclick="addManualQuestion()">Adicionar</button>
        </div>
      </div>
    </div>`)
}

window.addManualQuestion = function () {
  const s = state.scriptData
  const text = el('manual-q')?.value.trim()
  if (!s || !text) return
  const id = Math.max(0, ...s.questions.map(q => Number(q.id) || 0)) + 1
  s.questions.push({ id, category: 'Pergunta do advogado', text, rationale: '', aiFlag: false, priority: el('manual-q-prio')?.value || 'normal' })
  persistScripts()
  renderScriptResult(s)
}

window.removeQuestion = function (i) {
  const s = state.scriptData
  if (!s) return
  const [q] = s.questions.splice(i, 1)
  const st = state.hearing[s.id]
  if (st && q) { delete st.answers[q.id]; delete st.marks[q.id]; delete st.done[q.id] }
  persistScripts()
  renderScriptResult(s)
}

window.exportScript = function () {
  const s = state.scriptData
  if (!s) return
  const tl = timelineContextText()
  const lines = [
    `ROTEIRO DE OITIVA — INSTRUÇÃO PREVIDENCIÁRIA`,
    `Depoente: ${s.witness}`,
    `Gerado em: ${s.createdAt || todayISO()}`,
    `Caso: ${state.selectedCase?.title || '—'}`,
    ...(tl ? ['', tl] : []), '',
    ...s.questions.map((q, i) => `${i + 1}. [${q.category}${q.aiFlag ? ' ⚠' : ''}] ${q.text}`),
  ]
  downloadText(`roteiro_${s.witness.replace(/\s+/g, '_')}.txt`, lines.join('\n'))
}

// ── TAB 3: MODO AUDIÊNCIA ─────────────────────────────────────────

const MARKS = {
  fav: ['Favorável', 'var(--risk-low)'],
  neu: ['Neutra', 'var(--text-muted)'],
  des: ['Desfavorável', 'var(--risk-med)'],
  con: ['Contradição', 'var(--risk-high)'],
}

// Estado da gravação (fica fora do DOM para sobreviver à troca de pergunta/aba)
let _hMedia = null, _hStream = null, _hChunks = [], _hTimerId = null, _hStart = 0
let _hRecording = false, _hScriptId = null, _hPending = 0
const _audioUrls = {}

function hearingStore(scriptId) {
  const id = scriptId || state.scriptData?.id
  if (!id) return null
  if (!state.hearing[id]) state.hearing[id] = { notes: '', answers: {}, marks: {}, done: {}, audio: [], summary: '' }
  const st = state.hearing[id]
  st.answers = st.answers || {}; st.marks = st.marks || {}; st.done = st.done || {}; st.audio = st.audio || []
  return st
}
function persistHearing() {
  if (state.selectedCase) saveCaseFields(state.selectedCase.id, { hearing: state.hearing })
}

function renderHearingTab() {
  if (!state.scripts.length || !state.scriptData) {
    return `
      <div class="card"><div class="empty-state">
        <div class="empty-icon">🎙️</div>
        <div class="empty-title">Nenhum roteiro para conduzir</div>
        <div class="empty-desc">Monte o roteiro do primeiro depoente para usar o Modo Audiência.</div>
        <div style="margin-top:16px"><button class="btn btn-primary btn-sm" onclick="switchScriptTab('form')">Montar roteiro</button></div>
      </div></div>`
  }
  return `
    ${scriptChips('hearing')}
    <div class="hearing-layout">
      <div class="hearing-script" id="hearing-left">${renderHearingLeft()}</div>
      <div class="hearing-side" id="hearing-right">${renderHearingRight()}</div>
    </div>`
}

function renderHearingLeft() {
  const script = state.scriptData
  const st = hearingStore()
  const q = script.questions
  if (!q.length) return `<div class="alert-warn">Este roteiro está sem perguntas. Volte ao roteiro e adicione perguntas.</div>`
  const idx = Math.max(0, Math.min(state.activeQuestionIdx || 0, q.length - 1))
  state.activeQuestionIdx = idx
  const cur = q[idx]
  const prioColor = { critical: 'var(--risk-high)', high: 'var(--risk-med)', normal: 'var(--accent-blue)' }
  const pColor = prioColor[cur.priority] || 'var(--accent-blue)'
  const doneCount = q.filter(x => st.done[x.id]).length
  const pct = Math.round((doneCount / q.length) * 100)
  const curMark = st.marks[cur.id]

  return `
    <div class="hearing-script-header">
      <div style="font-size:13px;font-weight:600">${esc(script.witness)}</div>
      <div style="font-size:11px;color:var(--text-muted)">${doneCount} de ${q.length} respondidas</div>
      <div style="margin-left:auto"><button class="btn btn-ghost btn-sm" onclick="exportScript()" title="Exportar roteiro">Roteiro TXT</button></div>
    </div>
    <div class="lx-progress"><div style="width:${pct}%"></div></div>

    <div class="hearing-current-q" style="border-color:${pColor}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <span class="question-num" style="background:${pColor}22;color:${pColor}">${idx + 1}</span>
        <span class="badge badge-neutral">${esc(cur.category)}</span>
        ${cur.aiFlag ? '<span class="badge badge-risk-high">⚠ Contradição</span>' : ''}
        <span style="margin-left:auto;font-size:11px;color:${pColor}">${idx + 1} / ${q.length}</span>
      </div>
      <p style="font-size:15px;line-height:1.65;font-weight:500;margin:0">${esc(cur.text)}</p>
      ${cur.rationale ? `<p style="font-size:12px;color:var(--text-muted);margin-top:8px;font-style:italic">${esc(cur.rationale)}</p>` : ''}

      <label class="lx-mini-label" for="hq-answer">Resposta do(a) depoente</label>
      <textarea id="hq-answer" class="hearing-notes-area" placeholder="Anote o que foi respondido, com as palavras do depoente…" oninput="setAnswer(${idx}, this.value)">${esc(st.answers[cur.id] || '')}</textarea>

      <div class="lx-marks">
        ${Object.entries(MARKS).map(([k, [lbl, col]]) => `
          <button class="lx-mark ${curMark === k ? 'on' : ''}" style="--mark:${col}" onclick="setMark(${idx},'${k}')">${lbl}</button>`).join('')}
      </div>

      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" onclick="prevQuestion()" ${idx === 0 ? 'disabled' : ''}>← Anterior</button>
        <button class="btn btn-primary btn-sm" onclick="nextQuestion()" ${idx === q.length - 1 ? 'disabled' : ''}>Próxima →</button>
        <button class="btn btn-ghost btn-sm" onclick="markQuestionDone(${idx})" style="${st.done[cur.id] ? 'color:var(--risk-low)' : ''}">${st.done[cur.id] ? '✓ Respondida' : 'Marcar como respondida'}</button>
      </div>
    </div>

    <div class="hearing-q-list" id="hearing-q-list">
      ${q.map((question, i) => {
        const mk = st.marks[question.id]
        return `
        <div class="hearing-q-item ${i === idx ? 'active' : ''} ${st.done[question.id] ? 'done' : ''}" onclick="goToQuestion(${i})" id="hq-${i}">
          <span class="hq-num">${i + 1}</span>
          <span class="hq-text">${esc(question.text)}</span>
          ${mk ? `<span class="lx-dot" style="background:${MARKS[mk][1]}" title="${MARKS[mk][0]}"></span>` : ''}
          ${st.done[question.id] ? '<span style="color:var(--risk-low);font-size:12px;flex-shrink:0">✓</span>' : ''}
          ${question.aiFlag ? '<span style="color:var(--risk-high);font-size:11px;flex-shrink:0">⚠</span>' : ''}
        </div>`
      }).join('')}
    </div>`
}

function recButtons() {
  return _hRecording
    ? `<button class="btn btn-danger" onclick="stopHearingAudio()">■ Parar e transcrever</button>`
    : `<button class="btn btn-primary" onclick="startHearingAudio()">● Gravar áudio</button>
       <button class="btn btn-secondary btn-sm" onclick="el('audio-upload-input').click()">Enviar arquivo de áudio/vídeo</button>`
}

function renderHearingRight() {
  const script = state.scriptData
  const st = hearingStore()
  return `
    <div class="card" style="padding:20px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div class="lx-rec-icon" id="h-rec-icon">${_hRecording ? '<div class="record-dot"></div>' : '🎙'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:600" id="h-rec-title">${_hRecording ? 'Gravando…' : 'Gravação da oitiva (áudio)'}</div>
          <div style="font-size:12px;color:var(--text-muted)">${esc(script.witness)} · ${esc(state.selectedCase?.title || 'sem ação')}</div>
        </div>
        <div id="h-rec-timer" style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--risk-high);display:${_hRecording ? 'block' : 'none'}">00:00</div>
      </div>
      <div id="h-rec-error" class="alert-error" style="display:none"></div>
      <div id="h-rec-btns" style="display:flex;gap:10px;flex-wrap:wrap">${recButtons()}</div>
      <input type="file" id="audio-upload-input" accept="audio/*,video/*" style="display:none" onchange="handleAudioUpload(event)" />
      <div style="font-size:11px;color:var(--text-muted);margin-top:10px;line-height:1.5">O áudio é transcrito e analisado pela IA. Confirme com o juízo se a gravação é permitida na audiência. Limite de cerca de 25 MB por arquivo.</div>
    </div>

    <div id="hearing-audio-result">${renderAudioResults(st)}</div>

    <div class="card" style="padding:18px;margin-bottom:14px">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px">Anotações gerais da oitiva</div>
      <textarea id="hearing-notes" class="hearing-notes-area" placeholder="Reações, objeções, decisões do juízo, pontos para os memoriais…" style="min-height:120px" oninput="setHearingNotes(this.value)">${esc(st.notes || '')}</textarea>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="h-sum-btn" onclick="generateHearingSummary()">Gerar síntese da oitiva (IA)</button>
        <button class="btn btn-ghost btn-sm" onclick="exportHearingNotes()">Exportar anotações</button>
      </div>
    </div>
    <div id="hearing-summary">${renderHearingSummary(st)}</div>`
}

function renderAudioResults(st) {
  const pending = _hPending > 0
    ? `<div class="card" style="padding:16px;margin-bottom:14px;display:flex;align-items:center;gap:10px">${spinner()}<span style="font-size:13px;color:var(--text-secondary)">Transcrevendo e analisando o áudio…</span></div>` : ''
  const items = (st.audio || []).slice().reverse().map(a => {
    if (a.status === 'error') return `<div class="card" style="padding:14px 16px;margin-bottom:14px"><div class="alert-error" style="margin:0">${esc(a.error)}</div></div>`
    return `
      <div class="card" style="padding:16px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:600">Transcrição ${a.source === 'upload' ? '(arquivo enviado)' : '(gravação)'}</span>
          ${a.duration ? `<span class="badge badge-neutral">${esc(a.duration)}</span>` : ''}
          ${a.sentiment ? `<span class="badge badge-blue">${esc(a.sentiment)}</span>` : ''}
          <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">${new Date(a.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        ${a.summary ? `<p style="font-size:13px;line-height:1.55;margin:0 0 8px">${esc(a.summary)}</p>` : ''}
        ${(a.contradictions || []).length ? `<div style="font-size:12px;color:var(--risk-high);margin-bottom:6px">⚠ ${(a.contradictions || []).map(esc).join(' · ')}</div>` : ''}
        ${(a.aiFlags || []).length ? `<div style="font-size:12px;color:var(--risk-med);margin-bottom:6px">${(a.aiFlags || []).map(esc).join(' · ')}</div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button class="btn btn-secondary btn-sm" onclick="appendTranscript('${esc(a.id)}')">Colar transcrição nas anotações</button>
          <button class="btn btn-ghost btn-sm" onclick="copyTranscript('${esc(a.id)}')">Copiar</button>
          ${_audioUrls[a.id] ? `<a class="btn btn-ghost btn-sm" href="${_audioUrls[a.id]}" download="oitiva_${esc(a.id)}.webm" style="text-decoration:none">Baixar áudio</a>` : ''}
        </div>
      </div>`
  }).join('')
  return pending + items
}

function renderHearingSummary(st) {
  if (!st.summary) return ''
  return `
    <div class="card fade-up" style="padding:18px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px;flex-wrap:wrap">
        <div style="font-size:13px;font-weight:600">Síntese da oitiva</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="copyHearingSummary()">Copiar</button>
          <button class="btn btn-secondary btn-sm" onclick="navigate('reports',null)">Ir para relatórios e peças →</button>
        </div>
      </div>
      <div class="report-content">${mdToHtml(st.summary)}</div>
    </div>`
}

function afterHearingRender() {
  setTimeout(() => el('hq-' + state.activeQuestionIdx)?.scrollIntoView({ block: 'nearest' }), 60)
}

// ── Navegação e anotações por pergunta ──

function refreshHearing() {
  const left = el('hearing-left')
  if (!left) return
  left.innerHTML = renderHearingLeft()
  afterHearingRender()
}

window.setAnswer = function (idx, value) {
  const q = state.scriptData?.questions[idx]
  const st = hearingStore()
  if (!q || !st) return
  st.answers[q.id] = value
  persistHearing()
}

window.setMark = function (idx, mark) {
  const q = state.scriptData?.questions[idx]
  const st = hearingStore()
  if (!q || !st) return
  if (st.marks[q.id] === mark) delete st.marks[q.id]; else st.marks[q.id] = mark
  persistHearing()
  refreshHearing()
}

window.setHearingNotes = function (value) {
  const st = hearingStore()
  if (!st) return
  st.notes = value
  persistHearing()
}

window.prevQuestion = function () {
  if (!state.scriptData) return
  state.activeQuestionIdx = Math.max(0, (state.activeQuestionIdx || 0) - 1)
  refreshHearing()
}

window.nextQuestion = function () {
  const s = state.scriptData
  if (!s) return
  const st = hearingStore()
  const q = s.questions[state.activeQuestionIdx || 0]
  if (q && (st.answers[q.id] || '').trim() && !st.done[q.id]) { st.done[q.id] = true; persistHearing() }
  state.activeQuestionIdx = Math.min(s.questions.length - 1, (state.activeQuestionIdx || 0) + 1)
  refreshHearing()
}

window.goToQuestion = function (i) {
  state.activeQuestionIdx = i
  refreshHearing()
}

window.markQuestionDone = function (i) {
  const q = state.scriptData?.questions[i]
  const st = hearingStore()
  if (!q || !st) return
  if (st.done[q.id]) delete st.done[q.id]; else st.done[q.id] = true
  persistHearing()
  refreshHearing()
}

// ── Gravação de áudio da oitiva ──

function hShowError(msg) {
  const e = el('h-rec-error')
  if (e) { e.textContent = msg; e.style.display = 'block' }
}

window.startHearingAudio = async function () {
  if (!state.scriptData) return
  const err = el('h-rec-error'); if (err) err.style.display = 'none'
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    hShowError('Este navegador não permite gravar áudio. Use o botão de envio de arquivo.'); return
  }
  try {
    _hStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (e) {
    hShowError('Não foi possível acessar o microfone: ' + e.message + '. Verifique a permissão do navegador.'); return
  }
  _hChunks = []
  _hScriptId = state.scriptData.id
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || ''
  _hMedia = new MediaRecorder(_hStream, mime ? { mimeType: mime } : {})
  _hMedia.ondataavailable = e => { if (e.data.size) _hChunks.push(e.data) }
  _hMedia.onstop = onHearingAudioStop
  _hMedia.start(1000)
  _hRecording = true
  _hStart = Date.now()
  clearInterval(_hTimerId)
  _hTimerId = setInterval(() => {
    const t = el('h-rec-timer'); if (t) t.textContent = formatTime(Math.floor((Date.now() - _hStart) / 1000))
  }, 500)
  const badge = el('nav-badge-hearing'); if (badge) badge.style.display = 'inline-block'
  if (el('h-rec-btns')) {
    el('h-rec-btns').innerHTML = recButtons()
    el('h-rec-title').textContent = 'Gravando…'
    el('h-rec-icon').innerHTML = '<div class="record-dot"></div>'
    el('h-rec-timer').style.display = 'block'
  }
}

window.stopHearingAudio = function () {
  if (_hMedia && _hMedia.state !== 'inactive') _hMedia.stop()
}

async function onHearingAudioStop() {
  clearInterval(_hTimerId)
  const dur = formatTime(Math.floor((Date.now() - _hStart) / 1000))
  _hRecording = false
  _hStream?.getTracks().forEach(t => t.stop())
  _hStream = null
  const badge = el('nav-badge-hearing'); if (badge) badge.style.display = 'none'
  if (el('h-rec-btns')) {
    el('h-rec-btns').innerHTML = recButtons()
    el('h-rec-title').textContent = 'Gravação da oitiva (áudio)'
    el('h-rec-icon').textContent = '🎙'
    el('h-rec-timer').style.display = 'none'
  }
  const blob = new Blob(_hChunks, { type: _hMedia?.mimeType || 'audio/webm' })
  _hChunks = []
  if (blob.size < 1000) { hShowError('A gravação ficou vazia. Tente novamente.'); return }
  await processHearingAudio(blob, 'gravacao', _hScriptId, dur)
}

window.handleAudioUpload = async function (event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || !state.scriptData) return
  await processHearingAudio(file, 'upload', state.scriptData.id, '')
}

async function processHearingAudio(blob, source, scriptId, duration) {
  const st = hearingStore(scriptId)
  if (!st) return
  const refresh = () => { const box = el('hearing-audio-result'); if (box && state.scriptData?.id === scriptId) box.innerHTML = renderAudioResults(st) }
  _hPending++; refresh()
  const entry = { id: uid('au'), at: new Date().toISOString(), source, duration }
  _audioUrls[entry.id] = URL.createObjectURL(blob)
  try {
    const c = state.selectedCase
    const ctx = c ? `${c.title}. Benefício: ${c.benefit || 'não informado'}.` : ''
    const r = await analyzeAudioWithGroq(blob, ctx, { skipConvert: blob.type.startsWith('audio') && blob.size < 20 * 1024 * 1024 })
    Object.assign(entry, {
      status: 'done', summary: r.summary || '', keyPoints: r.keyPoints || [], contradictions: r.contradictions || [],
      aiFlags: r.aiFlags || [], sentiment: r.sentiment || '', transcript: (r.transcript || '').slice(0, 12000),
    })
  } catch (e) {
    Object.assign(entry, { status: 'error', error: e.message })
  }
  _hPending--
  st.audio.push(entry)
  if (st.audio.length > 6) st.audio = st.audio.slice(-6)
  persistHearing()
  refresh()
}

function findAudio(id) { return (hearingStore()?.audio || []).find(a => a.id === id) }

window.appendTranscript = function (id) {
  const a = findAudio(id), st = hearingStore()
  if (!a?.transcript || !st) return
  st.notes = (st.notes ? st.notes + '\n\n' : '') + `--- Transcrição automática (${a.source === 'upload' ? 'arquivo' : 'gravação'}) ---\n` + a.transcript
  persistHearing()
  const t = el('hearing-notes'); if (t) t.value = st.notes
}

window.copyTranscript = async function (id) {
  const a = findAudio(id)
  if (a?.transcript && await copyText(a.transcript)) alert('Transcrição copiada.')
}

// ── Síntese e exportação ──

window.generateHearingSummary = async function () {
  const script = state.scriptData, st = hearingStore(), c = state.selectedCase
  if (!script || !st) return
  const qa = script.questions.map((q, i) => {
    const ans = (st.answers[q.id] || '').trim(), mk = st.marks[q.id]
    return ans || mk ? `${i + 1}. [${q.category}] Pergunta: ${q.text}\n   Resposta: ${ans || '(sem anotação)'}${mk ? ` [${MARKS[mk][0]}]` : ''}` : null
  }).filter(Boolean).join('\n')
  const audio = (st.audio || []).filter(a => a.summary).map(a => `- ${a.summary}${(a.contradictions || []).length ? ' Contradições: ' + a.contradictions.join('; ') : ''}`).join('\n')
  if (!qa && !(st.notes || '').trim() && !audio) { alert('Anote ao menos uma resposta, escreva nas anotações ou grave o depoimento antes de gerar a síntese.'); return }

  const btn = el('h-sum-btn')
  btn.disabled = true; btn.innerHTML = `${spinner()} Gerando síntese…`
  try {
    const tl = timelineContextText()
    const sys = 'Você é um assistente jurídico especializado em DIREITO PREVIDENCIÁRIO brasileiro. Sintetize a instrução com objetividade, usando APENAS o que consta nas anotações. Não invente fatos, datas nem jurisprudência.'
    const prompt = `Elabore a síntese da oitiva abaixo, com seções marcadas por "## " e nesta ordem: Resumo do depoimento; Pontos favoráveis à tese; Pontos desfavoráveis e riscos; Contradições e lacunas (inclusive frente ao CNIS/linha do tempo); Sugestões para os memoriais e próximos passos.\n\nDepoente: ${script.witness}\nCaso: ${c ? `${c.title} — ${c.benefit || ''}` : 'sem ação vinculada'}\n${tl ? '\n' + tl + '\n' : ''}\nRESPOSTAS ANOTADAS:\n${qa || '(nenhuma)'}\n\nANOTAÇÕES GERAIS:\n${(st.notes || '').slice(0, 6000) || '(nenhuma)'}\n${audio ? '\nRESUMO DA TRANSCRIÇÃO:\n' + audio : ''}`
    st.summary = await groqChat([{ role: 'user', content: prompt }], sys, { temperature: 0.3, max_tokens: 1800 })
    persistHearing()
    set('hearing-summary', renderHearingSummary(st))
  } catch (e) {
    set('hearing-summary', `<div class="alert-error">${esc(e.message)}</div>`)
  }
  btn.disabled = false; btn.textContent = 'Gerar síntese da oitiva (IA)'
}

window.copyHearingSummary = async function () {
  const st = hearingStore()
  if (st?.summary && await copyText(st.summary)) alert('Síntese copiada.')
}

window.exportHearingNotes = function () {
  const script = state.scriptData, st = hearingStore(), c = state.selectedCase
  if (!script || !st) return
  const lines = [
    `ANOTAÇÕES DE OITIVA — AUDIÊNCIA PREVIDENCIÁRIA`,
    `Depoente: ${script.witness}`,
    `Caso: ${c?.title || '—'}`,
    `Data: ${new Date().toLocaleDateString('pt-BR')}`,
    '', 'ANOTAÇÕES GERAIS', st.notes || '(nenhuma)', '',
    '=== PERGUNTAS E RESPOSTAS ===',
    ...script.questions.map((q, i) => `${i + 1}. ${q.text}${st.done[q.id] ? ' [RESPONDIDA]' : ''}${st.marks[q.id] ? ` [${MARKS[st.marks[q.id]][0].toUpperCase()}]` : ''}\n   R: ${st.answers[q.id] || '—'}`),
    ...(st.summary ? ['', '=== SÍNTESE ===', st.summary] : []),
  ]
  downloadText(`oitiva_${script.witness.replace(/\s+/g, '_')}_${todayISO()}.txt`, lines.join('\n'))
}

// ─── VIDEO / DEPOSITIONS ──────────────────────────────────────────

function renderVideo() {
  const c = state.selectedCase
  set('main-content', `
    ${caseBar()}
    <div style="display:flex;flex-direction:column;gap:20px;max-width:960px;margin:0 auto">

      <!-- Formulário antes de gravar -->
      <div class="card" style="padding:24px" id="video-form-card">
        <div style="font-size:14px;font-weight:600;margin-bottom:18px">Novo Depoimento em Vídeo</div>
        <div class="grid-2" style="gap:14px">
          <div class="field">
            <label>Nome da Pessoa *</label>
            <input type="text" id="dep-nome" placeholder="Ex.: João da Silva" />
          </div>
          <div class="field">
            <label>Tipo de Depoimento *</label>
            <select id="dep-tipo">
              <option value="Parte Autora">Parte Autora</option>
              <option value="Parte Ré">Parte Ré</option>
              <option value="Testemunha da Parte Autora">Testemunha da Parte Autora</option>
              <option value="Testemunha da Parte Ré">Testemunha da Parte Ré</option>
              <option value="Perito">Perito</option>
              <option value="Outro">Outro</option>
            </select>
          </div>
          <div class="field">
            <label>Número do Processo</label>
            <input type="text" id="dep-processo" placeholder="${c?.number || '0000000-00.0000.0.00.0000'}" value="${c?.number || ''}" />
          </div>
          <div class="field">
            <label>Advogado Responsável</label>
            <input type="text" id="dep-advogado" placeholder="Dr. Nome Sobrenome" value="${state.currentUser?.name || ''}" />
          </div>
        </div>
        <div style="margin-top:16px">
          <button class="btn btn-primary" onclick="initVideoRecorder()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><polygon points="23 7 16 12 23 17 23 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="1" y="5" width="15" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>
            Iniciar Câmera
          </button>
        </div>
      </div>

      <!-- Player de câmera + canvas com overlay -->
      <div id="video-recorder-section" style="display:none">
        <div class="card" style="padding:20px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
            <div id="rec-icon-wrap" style="width:40px;height:40px;border-radius:50%;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;border:1px solid var(--border)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><polygon points="23 7 16 12 23 17 23 7" stroke="currentColor" stroke-width="1.5"/><rect x="1" y="5" width="15" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>
            </div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:600" id="rec-title">Câmera Pronta</div>
              <div style="font-size:12px;color:var(--text-muted)" id="rec-sub">GPS e localização sendo carregados…</div>
            </div>
            <div style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--risk-high);display:none" id="rec-timer">00:00</div>
          </div>

          <div id="rec-error" class="alert-error" style="display:none;margin-bottom:12px"></div>
          <div id="gps-status-bar" style="font-size:11px;color:var(--text-muted);margin-bottom:12px;padding:8px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)">
            📍 Aguardando GPS…
          </div>

          <!-- Canvas com overlay — é o que será gravado -->
          <div id="camera-preview-wrap" style="display:flex;justify-content:center;align-items:center;background:#000;border-radius:var(--radius-sm);overflow:hidden;margin-bottom:14px;min-height:240px;max-height:520px;position:relative;cursor:crosshair" onclick="tapToFocus(event)">
            <!-- Vídeo da câmera (oculto — apenas fonte para o canvas) -->
            <video id="dep-video-preview" autoplay muted playsinline style="display:none;position:absolute"></video>
            <!-- Canvas com overlay de dados — é o preview real e o que é gravado -->
            <canvas id="dep-canvas" style="width:100%;height:100%;max-height:520px;object-fit:contain;display:block"></canvas>
            <div id="focus-ring" style="display:none;position:absolute;width:56px;height:56px;border:2px solid #ffe066;border-radius:50%;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,0.5);transition:opacity 0.3s"></div>
          </div>
          
          <div style="display:flex;gap:10px;flex-wrap:wrap" id="rec-btns">
            <button class="btn btn-primary" onclick="startVideoRecording()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>
              Gravar
            </button>
            <button class="btn btn-ghost btn-sm" id="flip-camera-btn" title="Câmera traseira" onclick="flipCamera()" style="display:flex;align-items:center;gap:6px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 7h-3.5l-1.5-2H9L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" stroke-width="1.5"/><path d="M16 5l2-2 2 2M18 3v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Girar
            </button>
            <button class="btn btn-ghost btn-sm" onclick="cancelVideoRecorder()">Cancelar</button>
          </div>

          <div id="ffmpeg-progress" style="display:none;margin-top:14px">
            <div style="max-width:400px">${progressBar(0, 'var(--accent-teal)', 6)}</div>
            <div id="ffmpeg-progress-label" style="font-size:12px;color:var(--text-muted);margin-top:6px">Processando…</div>
          </div>
        </div>
      </div>

      <!-- Histórico de vídeos -->
      <div class="card" style="overflow:hidden">
        <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
          <span style="font-size:13px;font-weight:600">Depoimentos Gravados${c ? ' — ' + c.title : ''}</span>
          <span id="rec-count" class="badge badge-blue" style="display:none;margin-left:auto">0</span>
        </div>
        <div id="recordings-list">
          <div style="text-align:center;padding:24px">${spinner()}</div>
        </div>
      </div>

    </div>
  `)
  loadRecordingsFromFirebase()
}

async function loadRecordingsFromFirebase() {
  const c = state.selectedCase
  if (!c) { renderRecordingsList([]); const cnt0 = el('rec-count'); if (cnt0) cnt0.style.display = 'none'; return }
  try {
    const recs = await getRecordingsForCase(c.id)
    // Merge e salva em state.recordings para que watchRecording/downloadRec achem pelo id
    const mine = state.recordings.filter(r => r.caseId === c.id)
    const merged = [...mine, ...recs.filter(r => !mine.find(lr => lr.id === r.id)).map(r => ({ ...r, caseId: c.id }))]
    state.recordings = merged
    renderRecordingsList(merged)
    const cnt = el('rec-count')
    if (cnt && merged.length > 0) { cnt.textContent = merged.length; cnt.style.display = 'inline-flex' }
  } catch {
    renderRecordingsList(state.recordings)
  }
}

// ─── ESTADO DE GRAVAÇÃO DE VÍDEO ──────────────────────────────────

let _videoGpsData = {
  latitude: null, longitude: null, altitude: null, precisaoGps: null,
  cep: '', bairro: '', cidade: '', estado: '', endereco: '', statusGps: 'aguardando'
}
let _videoStream = null
let _canvasAnimFrame = null
let _videoMediaRecorder = null
let _videoFacingMode = 'user' // 'user' = frontal | 'environment' = traseira
let _videoChunks = []
let _videoStartTime = null

window.initVideoRecorder = async function() {
  const nome = el('dep-nome')?.value?.trim()
  const tipo = el('dep-tipo')?.value
  if (!nome) { alert('Informe o nome da pessoa antes de iniciar a câmera.'); return }

  el('video-form-card').style.display = 'none'
  el('video-recorder-section').style.display = 'block'

  // Solicita câmera + microfone — sem forçar resolução/aspecto, deixa a câmera decidir
  _videoFacingMode = 'user'
  try {
    _videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: _videoFacingMode },
      audio: true
    })
  } catch (err) {
    try {
      _videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    } catch (err2) {
      el('video-form-card').style.display = 'block'
      el('video-recorder-section').style.display = 'none'
      alert('Erro ao acessar câmera/microfone: ' + err2.message)
      return
    }
  }

  // Conecta vídeo ao preview e aguarda metadados para ler resolução real
  const videoEl = el('dep-video-preview')
  videoEl.srcObject = _videoStream
  await videoEl.play()

  // Aguarda resolução real da câmera ficar disponível
  await new Promise(resolve => {
    if (videoEl.videoWidth > 0) return resolve()
    videoEl.onloadedmetadata = resolve
    setTimeout(resolve, 1500) // fallback
  })

  // Ajusta canvas para o aspecto real da câmera (para gravação)
  const canvas = el('dep-canvas')
  const vw = videoEl.videoWidth || 1280
  const vh = videoEl.videoHeight || 720
  canvas.width = vw
  canvas.height = vh

  // Ajusta altura do preview wrapper ao aspecto real (portrait ou landscape)
  const wrap = el('camera-preview-wrap')
  if (wrap) {
    const isPortrait = vh > vw
    wrap.style.maxHeight = isPortrait ? '520px' : '360px'
    wrap.style.minHeight = isPortrait ? '300px' : '200px'
  }

  // Inicia loop de renderização do canvas
  startCanvasLoop()

  // Solicita GPS
  requestGps()
}

// ─── GIRAR CÂMERA (frente ↔ traseira) ────────────────────────────

window.flipCamera = async function() {
  if (_videoMediaRecorder && _videoMediaRecorder.state === 'recording') return // não gira durante gravação

  // Para tracks atuais
  _videoStream?.getTracks().forEach(t => t.stop())

  // Alterna modo
  _videoFacingMode = _videoFacingMode === 'user' ? 'environment' : 'user'

  try {
    _videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: _videoFacingMode },
      audio: true
    })
  } catch {
    try {
      _videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: _videoFacingMode }, audio: true })
    } catch (e) {
      // Reverte se falhar
      _videoFacingMode = _videoFacingMode === 'user' ? 'environment' : 'user'
      _videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: _videoFacingMode }, audio: true }).catch(() => null)
      if (!_videoStream) return
    }
  }

  const videoEl = el('dep-video-preview')
  videoEl.srcObject = _videoStream
  await videoEl.play()

  // Aguarda resolução real e reajusta canvas
  await new Promise(resolve => {
    if (videoEl.videoWidth > 0) return resolve()
    videoEl.onloadedmetadata = resolve
    setTimeout(resolve, 1500)
  })
  const canvas = el('dep-canvas')
  if (canvas && videoEl.videoWidth > 0) {
    canvas.width = videoEl.videoWidth
    canvas.height = videoEl.videoHeight
  }
  // Reajusta preview wrapper
  const wrap = el('camera-preview-wrap')
  if (wrap && videoEl.videoHeight > 0) {
    const isPortrait = videoEl.videoHeight > videoEl.videoWidth
    wrap.style.maxHeight = isPortrait ? '520px' : '360px'
    wrap.style.minHeight = isPortrait ? '300px' : '200px'
  }

  // Atualiza ícone do botão
  const btn = el('flip-camera-btn')
  if (btn) btn.title = _videoFacingMode === 'user' ? 'Câmera traseira' : 'Câmera frontal'
}

// ─── TOQUE PARA FOCAR ────────────────────────────────────────────

let _focusRingTimeout = null

window.tapToFocus = async function(event) {
  const wrap = el('camera-preview-wrap')
  const ring = el('focus-ring')
  if (!wrap || !ring) return

  // Posiciona o anel de foco no ponto tocado
  const rect = wrap.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  ring.style.left = (x - 28) + 'px'
  ring.style.top  = (y - 28) + 'px'
  ring.style.display = 'block'
  ring.style.opacity = '1'
  ring.style.transform = 'scale(1.2)'
  ring.style.transition = 'transform 0.15s ease, opacity 0.3s ease'

  // Anima contração do anel
  setTimeout(() => { ring.style.transform = 'scale(1)' }, 150)

  // Esconde o anel após 1.5s
  clearTimeout(_focusRingTimeout)
  _focusRingTimeout = setTimeout(() => {
    ring.style.opacity = '0'
    setTimeout(() => { ring.style.display = 'none' }, 300)
  }, 1500)

  // Tenta foco via API de câmera (funciona em celular/alguns navegadores)
  if (!_videoStream) return
  const [track] = _videoStream.getVideoTracks()
  if (!track) return

  const caps = track.getCapabilities?.() || {}
  if (!caps.focusMode) return // dispositivo não suporta foco manual

  // Calcula ponto normalizado (0–1) relativo ao vídeo real dentro do wrapper
  const videoEl = el('dep-video-preview')
  const vRatio = videoEl ? (videoEl.videoWidth / videoEl.videoHeight) : 1
  const wRatio = rect.width / rect.height
  let normX, normY

  if (vRatio > wRatio) {
    // vídeo tem barras em cima/baixo (letterbox vertical)
    const scaledH = rect.width / vRatio
    const offsetY = (rect.height - scaledH) / 2
    normX = x / rect.width
    normY = (y - offsetY) / scaledH
  } else {
    // vídeo tem barras nas laterais (pillarbox horizontal)
    const scaledW = rect.height * vRatio
    const offsetX = (rect.width - scaledW) / 2
    normX = (x - offsetX) / scaledW
    normY = y / rect.height
  }

  normX = Math.max(0, Math.min(1, normX))
  normY = Math.max(0, Math.min(1, normY))

  try {
    const constraints = { advanced: [{ focusMode: 'manual', focusDistance: undefined }] }
    if (caps.pointsOfInterest) {
      constraints.advanced = [{ pointsOfInterest: [{ x: normX, y: normY }], focusMode: 'manual' }]
    }
    await track.applyConstraints(constraints)
  } catch {
    // Silencia — dispositivo pode não suportar foco manual pontual
  }
}

function requestGps() {
  set('gps-status-bar', '📍 Solicitando localização GPS…')
  _videoGpsData.statusGps = 'solicitando'

  if (!navigator.geolocation) {
    _videoGpsData.statusGps = 'indisponível'
    set('gps-status-bar', '📍 GPS indisponível neste dispositivo')
    return
  }

  navigator.geolocation.getCurrentPosition(
    async pos => {
      _videoGpsData.latitude = pos.coords.latitude
      _videoGpsData.longitude = pos.coords.longitude
      _videoGpsData.altitude = pos.coords.altitude
      _videoGpsData.precisaoGps = pos.coords.accuracy
      _videoGpsData.statusGps = 'obtido'
      set('gps-status-bar', `📍 GPS obtido — Lat: ${pos.coords.latitude.toFixed(6)}, Lng: ${pos.coords.longitude.toFixed(6)} (±${Math.round(pos.coords.accuracy)}m) — Buscando endereço…`)
      await reverseGeocode(pos.coords.latitude, pos.coords.longitude)
    },
    err => {
      _videoGpsData.statusGps = 'erro: ' + err.message
      set('gps-status-bar', `📍 GPS indisponível: ${err.message}`)
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  )
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`, {
      headers: { 'Accept-Language': 'pt-BR' }
    })
    const data = await res.json()
    const addr = data.address || {}
    _videoGpsData.cep = addr.postcode || ''
    _videoGpsData.bairro = addr.suburb || addr.neighbourhood || addr.city_district || ''
    _videoGpsData.cidade = addr.city || addr.town || addr.municipality || ''
    _videoGpsData.estado = addr.state || ''
    _videoGpsData.endereco = data.display_name ? data.display_name.split(',').slice(0,3).join(',').trim() : ''
    set('gps-status-bar', `📍 ${_videoGpsData.endereco || _videoGpsData.cidade + '/' + _videoGpsData.estado} — CEP: ${_videoGpsData.cep || 'não disponível'}`)
  } catch(e) {
    set('gps-status-bar', `📍 Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)} (endereço não carregado)`)
  }
}

function startCanvasLoop() {
  const canvas = el('dep-canvas')
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const videoEl = el('dep-video-preview')

  function drawFrame() {
    if (!canvas) return

    if (videoEl && videoEl.readyState >= 2) {
      const vw = videoEl.videoWidth
      const vh = videoEl.videoHeight
      if (vw > 0 && vh > 0) {
        if (canvas.width !== vw || canvas.height !== vh) {
          canvas.width = vw
          canvas.height = vh
        }
        ctx.drawImage(videoEl, 0, 0, vw, vh)
      }
    } else {
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    drawWatermark(ctx, canvas.width, canvas.height)

    _canvasAnimFrame = requestAnimationFrame(drawFrame)
  }
  drawFrame()
}

function drawWatermark(ctx, W, H) {
  const now = new Date()
  const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const nomePessoa = el('dep-nome')?.value || '—'
  const tipo = el('dep-tipo')?.value || '—'
  const processo = el('dep-processo')?.value || '—'
  const gps = _videoGpsData

  const PAD = 18
  const maxW = W - PAD * 2
  ctx.textBaseline = 'top'

  // Sombra dupla para legibilidade em qualquer fundo (claro ou escuro)
  function setShadow(ctx) {
    ctx.shadowColor = 'rgba(0,0,0,0.95)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 1
  }
  function clearShadow(ctx) {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  }

  // Posição do rodapé
  const overlayH = 220
  let y = H - overlayH + 14

  setShadow(ctx)

  // Linha 1: Data/Hora — branco puro, sempre visível
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 22px monospace'
  ctx.fillText(`${dateStr}  ${timeStr}`, PAD, y); y += 32

  // Linha 2: Nome + Tipo — amarelo forte com contorno escuro
  ctx.font = 'bold 20px monospace'
  ctx.fillStyle = '#ffe066'
  const nomeStr = `${nomePessoa}  |  ${tipo}`
  let ns = nomeStr
  while (ctx.measureText(ns).width > maxW && ns.length > 6) ns = ns.slice(0,-2) + '…'
  ctx.fillText(ns, PAD, y); y += 30

  // Linha 3: Processo
  ctx.font = '17px monospace'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(`Processo: ${processo}`, PAD, y); y += 26

  // Linha 4: GPS lat/lng
  const latStr = gps.latitude != null ? `Lat: ${gps.latitude.toFixed(6)}` : 'Lat: —'
  const lngStr = gps.longitude != null ? `Lng: ${gps.longitude.toFixed(6)}` : 'Lng: —'
  const altStr = gps.altitude != null ? `Alt: ${gps.altitude.toFixed(1)}m` : ''
  const accStr = gps.precisaoGps != null ? `±${Math.round(gps.precisaoGps)}m` : ''
  ctx.fillStyle = '#ffffff'
  ctx.font = '15px monospace'
  ctx.fillText(`${latStr}  ${lngStr}`, PAD, y); y += 22
  if (altStr || accStr) { ctx.fillText(`${altStr}  ${accStr}`.trim(), PAD, y); y += 22 }

  // Linha 5: Endereço/CEP
  const endLine = [gps.endereco, gps.cep ? 'CEP ' + gps.cep : '', gps.cidade, gps.estado].filter(Boolean).join('  |  ')
  ctx.fillStyle = '#ffffff'
  ctx.font = '14px monospace'
  let endTrunc = endLine || ('GPS: ' + gps.statusGps)
  while (ctx.measureText(endTrunc).width > maxW && endTrunc.length > 8) endTrunc = endTrunc.slice(0,-2) + '…'
  ctx.fillText(endTrunc, PAD, y); y += 20

  // Linha 6: Status GPS
  ctx.fillStyle = '#ffffff'
  ctx.font = '12px monospace'
  ctx.fillText(`GPS: ${gps.statusGps}`, PAD, y)

  // Marca d'água "LEXIS AI" no canto superior direito
  ctx.save()
  setShadow(ctx)
  ctx.globalAlpha = 0.85
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 17px monospace'
  ctx.textAlign = 'right'
  ctx.fillText('LEXIS AI', W - PAD, PAD)
  ctx.font = '13px monospace'
  ctx.fillText('INSTRUÇÃO CONCENTRADA', W - PAD, PAD + 22)
  ctx.restore()
  clearShadow(ctx)
  ctx.textAlign = 'left'
}

window.startVideoRecording = function() {
  if (!_videoStream || !el('dep-canvas')) return

  _videoChunks = []
  _videoStartTime = new Date()

  // Captura o stream do CANVAS (não da câmera diretamente)
  const canvas = el('dep-canvas')
  const canvasStream = canvas.captureStream(25)

  // Adiciona faixas de áudio do stream original
  const audioTracks = _videoStream.getAudioTracks()
  audioTracks.forEach(t => canvasStream.addTrack(t))

  // Tenta formatos suportados
  const mimeTypes = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
  let mimeType = ''
  for (const m of mimeTypes) {
    if (MediaRecorder.isTypeSupported(m)) { mimeType = m; break }
  }

  _videoMediaRecorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : {})
  _videoMediaRecorder.ondataavailable = e => { if (e.data.size > 0) _videoChunks.push(e.data) }
  _videoMediaRecorder.onstop = onVideoRecordingStop
  _videoMediaRecorder.start(1000)

  // Timer
  state.recordingElapsed = 0
  clearInterval(state.recordingTimer)
  state.recordingTimer = setInterval(() => {
    state.recordingElapsed++
    const t = el('rec-timer'); if (t) t.textContent = formatTime(state.recordingElapsed)
  }, 1000)

  el('rec-timer').style.display = 'block'
  el('rec-title').textContent = '● Gravando…'
  el('rec-icon-wrap').innerHTML = '<div class="record-dot"></div>'
  el('rec-btns').innerHTML = `
    <button class="btn btn-danger" onclick="stopVideoRecording()">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor"/></svg>
      Finalizar Gravação
    </button>
    <button class="btn btn-ghost btn-sm" onclick="retakeVideo()" style="display:flex;align-items:center;gap:6px" title="Descartar e regravar">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M1 4v6h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 15a9 9 0 1 0 .49-5.66L1 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Refazer
    </button>`
}

window.stopVideoRecording = function() {
  clearInterval(state.recordingTimer)
  if (_videoMediaRecorder && _videoMediaRecorder.state !== 'inactive') {
    _videoMediaRecorder.stop()
  }
  el('rec-btns').innerHTML = `<div style="font-size:13px;color:var(--text-muted)">${spinner()} Processando gravação…</div>`
  el('rec-title').textContent = 'Processando…'
  el('rec-timer').style.display = 'none'
}

async function onVideoRecordingStop() {
  const dataFim = new Date()
  const blob = new Blob(_videoChunks, { type: 'video/webm' })
  const duracao = formatTime(state.recordingElapsed)

  const c = state.selectedCase
  const meta = {
    nomePessoa: el('dep-nome')?.value?.trim() || '—',
    tipoDepoimento: el('dep-tipo')?.value || '—',
    numeroProcesso: el('dep-processo')?.value?.trim() || c?.number || '',
    advogado: el('dep-advogado')?.value?.trim() || state.currentUser?.name || '',
    dataInicio: _videoStartTime?.toISOString() || new Date().toISOString(),
    dataFim: dataFim.toISOString(),
    duracao,
    ..._videoGpsData,
  }

  // Para o loop do canvas e a câmera
  cancelAnimationFrame(_canvasAnimFrame)
  _videoStream?.getTracks().forEach(t => t.stop())
  _videoStream = null

  // Cria entrada local imediata com status "analisando"
  const localId = `rec_${Date.now()}`
  const localRec = {
    id: localId,
    caseId: c?.id || null,
    nomePessoa: meta.nomePessoa,
    tipoDepoimento: meta.tipoDepoimento,
    duracao,
    cidade: meta.cidade,
    estado: meta.estado,
    criadoEm: new Date().toISOString(),
    videoUrl: URL.createObjectURL(blob),
    _blob: blob,
    _local: true,
    _analisando: true,
    analise: null,
  }
  state.recordings.unshift(localRec)
  renderRecordingsList(state.recordings)
  const cnt = el('rec-count')
  if (cnt) { cnt.textContent = state.recordings.length; cnt.style.display = 'inline-flex' }

  // Volta UI ao formulário
  el('video-recorder-section').style.display = 'none'
  el('video-form-card').style.display = 'block'

  // ── Análise IA em paralelo ─────────────────────────────────────
  analyzeVideoWithAI(blob, meta, localId, c)

  // Upload agora é manual — botão aparece no card após análise IA
}

// ─── ANÁLISE IA DO VÍDEO ──────────────────────────────────────────

async function analyzeVideoWithAI(blob, meta, localId, caseData) {
  const key = getGroqKey()
  if (!key) {
    updateRecAnalise(localId, { erro: 'Chave Groq não configurada.' })
    return
  }

  try {
    // Extrai áudio do blob via FFmpeg para enviar ao Whisper
    let audioBlob = blob
    try { audioBlob = await extractAudioMp3(blob, () => {}) } catch {}

    // Transcreve com Groq Whisper
    const formData = new FormData()
    const ext = audioBlob.type.includes('mp3') ? 'mp3' : 'webm'
    formData.append('file', new File([audioBlob], `audio.${ext}`, { type: audioBlob.type || 'audio/webm' }))
    formData.append('model', 'whisper-large-v3')
    formData.append('language', 'pt')
    formData.append('response_format', 'json')

    const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: formData,
    })
    if (!whisperRes.ok) throw new Error(`Whisper HTTP ${whisperRes.status}`)
    const whisperData = await whisperRes.json()
    const transcript = whisperData.text?.trim() || ''

    if (!transcript) {
      updateRecAnalise(localId, { transcricao: '', resumo: 'Nenhuma fala detectada no áudio.', erro: null })
      return
    }

    // Análise jurídica completa com Groq Llama
    const systemPrompt = `Você é um assistente jurídico especializado em direito previdenciário e trabalhista brasileiro. Analise depoimentos gravados em instrução concentrada de forma precisa e objetiva. Responda SOMENTE em JSON válido, sem markdown, sem texto fora do JSON.`

    const caseCtx = caseData ? `Caso: ${caseData.title || ''}. Número: ${caseData.number || ''}. Área: ${caseData.category || ''}. Cliente: ${caseData.clientName || ''}.` : ''

    const userPrompt = `Analise este depoimento de instrução concentrada e retorne SOMENTE este JSON:
{
  "transcricao": "${transcript.replace(/"/g, '\\"')}",
  "resumo": "resumo objetivo do depoimento em 3-4 frases",
  "pontosChave": ["ponto jurídico relevante 1", "ponto 2", "ponto 3"],
  "contradicoes": ["contradição ou inconsistência encontrada (lista vazia se nenhuma)"],
  "alertasJuridicos": ["alerta ou risco jurídico identificado"],
  "sentimento": "cooperativo|evasivo|contraditório|nervoso|seguro|neutro",
  "credibilidade": "alta|média|baixa",
  "nivelRisco": "low|medium|high",
  "recomendacoes": ["recomendação estratégica 1", "recomendação 2"],
  "trechosCriticos": ["trecho textual importante do depoimento (máx 3)"]
}

Depoimento de: ${meta.nomePessoa} (${meta.tipoDepoimento})
${caseCtx}
Transcrição: ${transcript}`

    const raw = await groqChat([{ role: 'user', content: userPrompt }], systemPrompt, { temperature: 0.3, max_tokens: 2000 })
    let analise
    try { analise = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
    catch { analise = { transcricao: transcript, resumo: raw, pontosChave: [], contradicoes: [], alertasJuridicos: [], sentimento: 'neutro', credibilidade: 'média', nivelRisco: 'medium', recomendacoes: [], trechosCriticos: [] } }

    updateRecAnalise(localId, analise)

  } catch (e) {
    console.warn('[IA análise vídeo]', e.message)
    updateRecAnalise(localId, { erro: e.message })
  }
}

function updateRecAnalise(localId, analise) {
  const idx = state.recordings.findIndex(r => r.id === localId)
  if (idx >= 0) {
    state.recordings[idx] = { ...state.recordings[idx], analise, _analisando: false }
    renderRecordingsList(state.recordings)
  }
}

// ─── SALVAR NO FIREBASE (manual, com relatório IA) ────────────────

window.saveRecToFirebase = async function(localId) {
  const rec = state.recordings.find(r => r.id === localId)
  if (!rec?._blob) return

  const c = state.selectedCase
  if (!c) { alert('Selecione um caso antes de salvar.'); return }
  if (!state.fbStorage) { alert('Firebase Storage não configurado.'); return }

  // Desabilita botão e mostra progresso
  const btn = el(`save-fb-btn-${localId}`)
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…' }

  // Mostra barra de progresso
  const progressEl = el('ffmpeg-progress')
  const progressFill = progressEl?.querySelector('.progress-fill')
  const progressLabel = el('ffmpeg-progress-label')
  if (progressEl) progressEl.style.display = 'block'

  try {
    const meta = {
      nomePessoa: rec.nomePessoa || '—',
      tipoDepoimento: rec.tipoDepoimento || '—',
      numeroProcesso: rec.numeroProcesso || c.number || '',
      advogado: rec.advogado || state.currentUser?.name || '',
      dataInicio: rec.dataInicio || rec.criadoEm || new Date().toISOString(),
      dataFim: rec.dataFim || rec.criadoEm || new Date().toISOString(),
      duracao: rec.duracao || '—',
      latitude: rec.latitude ?? null,
      longitude: rec.longitude ?? null,
      altitude: rec.altitude ?? null,
      precisaoGps: rec.precisaoGps ?? null,
      cep: rec.cep || '', bairro: rec.bairro || '',
      cidade: rec.cidade || '', estado: rec.estado || '',
      endereco: rec.endereco || '', statusGps: rec.statusGps || 'indisponível',
    }

    const saved = await uploadVideoToFirebase(c.id, rec._blob, meta, ({ stage, pct }) => {
      if (progressFill) progressFill.style.width = pct + '%'
      if (progressLabel) progressLabel.textContent = `${stage} (${pct}%)`
    })

    // Salva o relatório IA junto no Firestore
    if (rec.analise && state.fbDb && saved.nomeArquivo) {
      const docRef = collection(state.fbDb, 'processos', c.id, 'videos')
      const snap = await getDocs(query(docRef, where('nomeArquivo', '==', saved.nomeArquivo)))
      snap.forEach(d => updateDoc(d.ref, { analise: rec.analise }).catch(() => {}))
    }

    if (progressLabel) progressLabel.textContent = '✓ Salvo no banco de dados com relatório IA!'

    // Atualiza o registro local para refletir que foi salvo
    const idx = state.recordings.findIndex(r => r.id === localId)
    if (idx >= 0) {
      state.recordings[idx] = { ...state.recordings[idx], ...saved, _local: false, _blob: null }
      renderRecordingsList(state.recordings)
    }

    setTimeout(() => { if (progressEl) progressEl.style.display = 'none' }, 3000)

  } catch (err) {
    console.warn('[Salvar Firebase]', err.message)
    if (progressLabel) { progressLabel.style.color = 'var(--risk-high)'; progressLabel.textContent = '✗ Erro: ' + err.message }
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar Firebase' }
  }
}

window.retakeVideo = async function() {
  // Para gravação em curso e descarta os chunks
  clearInterval(state.recordingTimer)
  if (_videoMediaRecorder && _videoMediaRecorder.state !== 'inactive') {
    _videoMediaRecorder.onstop = null // ignora o onVideoRecordingStop
    _videoMediaRecorder.stop()
  }
  _videoMediaRecorder = null
  _videoChunks = []
  state.recordingElapsed = 0

  // Para câmera atual e reinicia stream
  cancelAnimationFrame(_canvasAnimFrame)
  _videoStream?.getTracks().forEach(t => t.stop())
  _videoStream = null

  // Reseta UI para estado "câmera pronta"
  el('rec-timer').style.display = 'none'
  el('rec-timer').textContent = '00:00'
  el('rec-title').textContent = 'Câmera Pronta'
  el('rec-icon-wrap').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><polygon points="23 7 16 12 23 17 23 7" stroke="currentColor" stroke-width="1.5"/><rect x="1" y="5" width="15" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>'
  el('rec-btns').innerHTML = `
    <button class="btn btn-primary" onclick="startVideoRecording()">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>
      Gravar
    </button>
    <button class="btn btn-ghost btn-sm" id="flip-camera-btn" title="Câmera traseira" onclick="flipCamera()" style="display:flex;align-items:center;gap:6px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 7h-3.5l-1.5-2H9L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" stroke-width="1.5"/><path d="M16 5l2-2 2 2M18 3v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Girar
    </button>
    <button class="btn btn-ghost btn-sm" onclick="cancelVideoRecorder()">Cancelar</button>`

  // Reinicia câmera com o mesmo facingMode
  try {
    _videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: _videoFacingMode }, audio: true })
  } catch {
    _videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => null)
  }
  if (!_videoStream) return

  const videoEl = el('dep-video-preview')
  videoEl.srcObject = _videoStream
  await videoEl.play()

  await new Promise(resolve => {
    if (videoEl.videoWidth > 0) return resolve()
    videoEl.onloadedmetadata = resolve
    setTimeout(resolve, 1500)
  })

  const canvas = el('dep-canvas')
  if (canvas) { canvas.width = videoEl.videoWidth || 1280; canvas.height = videoEl.videoHeight || 720 }

  startCanvasLoop()
}

window.cancelVideoRecorder = function() {
  cancelAnimationFrame(_canvasAnimFrame)
  clearInterval(state.recordingTimer)
  _videoStream?.getTracks().forEach(t => t.stop())
  _videoStream = null
  if (_videoMediaRecorder && _videoMediaRecorder.state !== 'inactive') _videoMediaRecorder.stop()
  el('video-recorder-section').style.display = 'none'
  el('video-form-card').style.display = 'block'
}

// Mantém compatibilidade com chamadas do hearing mode

function renderRecordingsList(recs) {
  if (!recs || !recs.length) {
    set('recordings-list', '<div class="empty-state"><div class="empty-icon">🎥</div><div class="empty-desc">Nenhum depoimento gravado ainda.</div></div>')
    return
  }
  set('recordings-list', recs.map(v => {
    const data = v.criadoEm
      ? (v.criadoEm.toDate ? v.criadoEm.toDate().toLocaleString('pt-BR') : new Date(v.criadoEm).toLocaleString('pt-BR'))
      : (v.date || '—')
    const local = v._local ? `<span class="badge badge-gold" style="font-size:10px">local</span>` : `<span class="badge badge-blue" style="font-size:10px">Firebase ✓</span>`
    const cidadeUF = [v.cidade, v.estado].filter(Boolean).join('/')

    // Badge de status da análise IA
    let aiStatus = ''
    if (v._analisando) {
      aiStatus = `<span class="badge badge-gold" style="font-size:10px">${spinner()} Analisando…</span>`
    } else if (v.analise?.erro) {
      aiStatus = `<span class="badge badge-risk-high" style="font-size:10px">⚠ Erro IA</span>`
    } else if (v.analise) {
      const riskColor = { low: 'badge-risk-low', medium: 'badge-risk-med', high: 'badge-risk-high' }[v.analise.nivelRisco] || 'badge-neutral'
      aiStatus = `<span class="badge badge-teal" style="font-size:10px">✓ IA Analisado</span><span class="badge ${riskColor}" style="font-size:10px">Risco ${fmt.risk(v.analise.nivelRisco)}</span>`
    }

    // Preview da transcrição
    const transcPreview = v.analise?.transcricao
      ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px;padding:8px 10px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border);max-height:60px;overflow:hidden;line-height:1.5">"${v.analise.transcricao.slice(0,160)}${v.analise.transcricao.length > 160 ? '…' : ''}"</div>`
      : ''

    return `
    <div style="padding:16px 20px;border-bottom:1px solid var(--border)" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background=''">
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div style="font-size:22px;margin-top:2px">🎥</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;margin-bottom:2px">${v.nomePessoa || v.name || '—'}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${v.tipoDepoimento || '—'} · ${data} · ${v.duracao || '—'}${cidadeUF ? ' · ' + cidadeUF : ''}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px">${local}${aiStatus}</div>
          ${transcPreview}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          ${(v.videoUrl || v.url || v._blob) ? `<button class="btn btn-primary btn-sm" onclick="watchRecording('${v.id}')">▶ Assistir</button>` : ''}
          ${(v.videoUrl || v.url || v._blob) ? `<button class="btn btn-ghost btn-sm" onclick="downloadRec('${v.id}')">⬇ Baixar</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="generateRecReport('${v.id}')" ${v._analisando ? 'disabled' : ''}>📄 Relatório</button>
          ${v.analise && !v.analise.erro ? `<button class="btn btn-ghost btn-sm" onclick="viewAiAnalysis('${v.id}')">🔍 Ver IA</button>` : ''}
          ${v._local && !v._analisando && v._blob ? `<button class="btn btn-primary btn-sm" id="save-fb-btn-${v.id}" onclick="saveRecToFirebase('${v.id}')" style="background:var(--accent-teal);border-color:var(--accent-teal)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" stroke-width="1.5"/><polyline points="17 21 17 13 7 13 7 21" stroke="currentColor" stroke-width="1.5"/><polyline points="7 3 7 8 15 8" stroke="currentColor" stroke-width="1.5"/></svg>
            Salvar Video
          </button>` : ''}
        </div>
      </div>
    </div>`
  }).join(''))
}

window.viewAiAnalysis = function(id) {
  const rec = state.recordings.find(r => r.id === id)
  if (!rec?.analise) return
  const a = rec.analise
  const riskLabel = { low: '🟢 Baixo', medium: '🟡 Médio', high: '🔴 Alto' }[a.nivelRisco] || a.nivelRisco
  const credLabel = { alta: '✅ Alta', média: '⚠️ Média', baixa: '❌ Baixa' }[a.credibilidade] || a.credibilidade

  // Abre painel de análise inline
  const panelId = `ai-panel-${id}`
  const existing = document.getElementById(panelId)
  if (existing) { existing.remove(); return }

  const container = document.createElement('div')
  container.id = panelId
  container.innerHTML = `
    <div class="card fade-up" style="margin:16px 20px 8px;padding:20px;border:1px solid var(--accent-blue);background:var(--bg-elevated)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:13px;font-weight:600;color:var(--accent-blue)">🤖 Análise IA — ${rec.nomePessoa}</div>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('${panelId}').remove()">✕</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <span class="badge badge-neutral">Sentimento: ${a.sentimento || '—'}</span>
        <span class="badge badge-neutral">Credibilidade: ${credLabel}</span>
        <span class="badge badge-neutral">Risco: ${riskLabel}</span>
      </div>
      <div style="font-size:13px;line-height:1.7;color:var(--text-secondary);margin-bottom:14px;padding:12px;background:var(--bg-base);border-radius:var(--radius-sm)">${a.resumo || '—'}</div>
      ${a.pontosChave?.length ? `<div style="margin-bottom:10px"><div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px">PONTOS-CHAVE</div>${a.pontosChave.map(p => `<div style="font-size:12px;padding:3px 0;border-bottom:1px solid var(--border)">• ${p}</div>`).join('')}</div>` : ''}
      ${a.contradicoes?.length ? `<div style="margin-bottom:10px"><div style="font-size:11px;font-weight:600;color:var(--risk-high);margin-bottom:6px">⚠ CONTRADIÇÕES</div>${a.contradicoes.map(c => `<div style="font-size:12px;padding:3px 0;color:var(--risk-high)">• ${c}</div>`).join('')}</div>` : ''}
      ${a.alertasJuridicos?.length ? `<div style="margin-bottom:10px"><div style="font-size:11px;font-weight:600;color:var(--risk-med);margin-bottom:6px">⚡ ALERTAS JURÍDICOS</div>${a.alertasJuridicos.map(al => `<div style="font-size:12px;padding:3px 0;color:var(--risk-med)">• ${al}</div>`).join('')}</div>` : ''}
      ${a.recomendacoes?.length ? `<div style="margin-bottom:10px"><div style="font-size:11px;font-weight:600;color:var(--risk-low);margin-bottom:6px">✅ RECOMENDAÇÕES</div>${a.recomendacoes.map(r => `<div style="font-size:12px;padding:3px 0">• ${r}</div>`).join('')}</div>` : ''}
      ${a.transcricao ? `<details style="margin-top:10px"><summary style="font-size:12px;font-weight:600;color:var(--text-muted);cursor:pointer">Ver transcrição completa</summary><div style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin-top:8px;padding:10px;background:var(--bg-base);border-radius:var(--radius-sm);max-height:200px;overflow-y:auto">${a.transcricao}</div></details>` : ''}
    </div>`

  // Insere após o card do depoimento correspondente
  const recCards = document.querySelectorAll('#recordings-list > div')
  const recIdx = state.recordings.findIndex(r => r.id === id)
  if (recCards[recIdx]) recCards[recIdx].after(container)
  else el('recordings-list').appendChild(container)
}

window.watchRecording = function(id) {
  const rec = state.recordings.find(r => r.id === id)
  if (!rec) { alert('Registro não encontrado. Recarregue a página e tente novamente.'); return }
  const url = rec.videoUrl || rec.url || (rec._blob ? URL.createObjectURL(rec._blob) : null)
  if (!url) { alert('URL do vídeo não disponível.'); return }

  // Remove modal anterior se existir
  const existing = document.getElementById('video-watch-modal')
  if (existing) existing.remove()

  const name = rec.nomePessoa || 'Depoimento'
  const modal = document.createElement('div')
  modal.id = 'video-watch-modal'
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;-webkit-overflow-scrolling:touch'

  // Cria elementos via DOM (mais compatível que innerHTML para video em iOS/Safari)
  const inner = document.createElement('div')
  inner.style.cssText = 'width:100%;max-width:860px;display:flex;flex-direction:column;gap:12px'

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between'
  header.innerHTML = `<div style="color:#fff;font-size:14px;font-weight:600;opacity:0.9">▶ ${name} — ${rec.tipoDepoimento || ''}</div>`
  const closeBtn = document.createElement('button')
  closeBtn.textContent = '✕'
  closeBtn.style.cssText = 'background:rgba(255,255,255,0.12);border:none;color:#fff;width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center'
  closeBtn.onclick = () => modal.remove()
  header.appendChild(closeBtn)

  const video = document.createElement('video')
  video.src = url
  video.controls = true
  video.autoplay = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.style.cssText = 'width:100%;max-height:70vh;border-radius:8px;background:#000;outline:none;display:block'

  // Trata erro de carregamento
  video.onerror = () => {
    video.style.display = 'none'
    const errMsg = document.createElement('div')
    errMsg.style.cssText = 'color:#ff6b6b;padding:24px;text-align:center;font-size:13px'
    errMsg.textContent = 'Não foi possível reproduzir o vídeo neste dispositivo. Use o botão Baixar Vídeo.'
    inner.insertBefore(errMsg, footer)
  }

  const footer = document.createElement('div')
  footer.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap'

  const dlBtn = document.createElement('button')
  dlBtn.className = 'btn btn-ghost btn-sm'
  dlBtn.style.cssText = 'color:#fff;border-color:rgba(255,255,255,0.2)'
  dlBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Baixar Vídeo`
  dlBtn.onclick = () => downloadRec(id)

  const closeBtnFooter = document.createElement('button')
  closeBtnFooter.className = 'btn btn-ghost btn-sm'
  closeBtnFooter.style.cssText = 'color:#fff;border-color:rgba(255,255,255,0.2)'
  closeBtnFooter.textContent = 'Fechar'
  closeBtnFooter.onclick = () => modal.remove()

  footer.appendChild(dlBtn)
  footer.appendChild(closeBtnFooter)
  inner.appendChild(header)
  inner.appendChild(video)
  inner.appendChild(footer)
  modal.appendChild(inner)

  // Fecha ao clicar no fundo escuro
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
}

window.downloadRec = async function(id) {
  const rec = state.recordings.find(r => r.id === id)
  if (!rec) { alert('Registro não encontrado. Recarregue a página e tente novamente.'); return }
  const fileName = rec.nomeArquivo || ((rec.nomePessoa || 'depoimento').replace(/\s+/g,'_') + '.mp4')

  function triggerDownload(blobUrl, name) {
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = name
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl) }, 10000)
  }

  // Vídeo local (Blob em memória) — download direto
  if (rec._blob) {
    triggerDownload(URL.createObjectURL(rec._blob), fileName)
    return
  }

  const url = rec.videoUrl || rec.url
  if (!url) { alert('URL do vídeo não disponível.'); return }

  // Tenta fetch para forçar download como Blob (resolve CORS Firebase em desktop)
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const blob = await res.blob()
    triggerDownload(URL.createObjectURL(blob), fileName)
  } catch {
    // Fallback para iOS/Safari/mobile: abre a URL diretamente (usuário segura para salvar)
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => document.body.removeChild(a), 1000)
  }
}

window.generateRecReport = function(id) {
  const rec = state.recordings.find(r => r.id === id)
  if (!rec) return
  const lines = [
    'RELATÓRIO DE DEPOIMENTO — INSTRUÇÃO CONCENTRADA',
    '═══════════════════════════════════════════════',
    `Pessoa:          ${rec.nomePessoa || '—'}`,
    `Tipo:            ${rec.tipoDepoimento || '—'}`,
    `Processo:        ${rec.numeroProcesso || '—'}`,
    `Advogado:        ${rec.advogado || '—'}`,
    `Data/Hora Início: ${rec.dataInicio ? new Date(rec.dataInicio).toLocaleString('pt-BR') : '—'}`,
    `Data/Hora Fim:    ${rec.dataFim ? new Date(rec.dataFim).toLocaleString('pt-BR') : '—'}`,
    `Duração:         ${rec.duracao || '—'}`,
    '───────────────────────────────────────────────',
    'LOCALIZAÇÃO GPS',
    `Latitude:        ${rec.latitude ?? '—'}`,
    `Longitude:       ${rec.longitude ?? '—'}`,
    `Altitude:        ${rec.altitude != null ? rec.altitude + 'm' : '—'}`,
    `Precisão GPS:    ${rec.precisaoGps != null ? '±' + Math.round(rec.precisaoGps) + 'm' : '—'}`,
    `CEP:             ${rec.cep || '—'}`,
    `Bairro:          ${rec.bairro || '—'}`,
    `Cidade/UF:       ${[rec.cidade, rec.estado].filter(Boolean).join('/') || '—'}`,
    `Endereço:        ${rec.endereco || '—'}`,
    `Status GPS:      ${rec.statusGps || '—'}`,
    '───────────────────────────────────────────────',
    `Arquivo:         ${rec.nomeArquivo || '—'}`,
    `URL Firebase:    ${rec.videoUrl || '—'}`,
    `Tamanho:         ${rec.size || '—'}`,
  ]
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }))
  a.download = `relatorio_${(rec.nomePessoa || 'dep').replace(/\s+/g,'_')}.txt`
  a.click()
}

function formatTime(s) {
  const m = Math.floor(s / 60), sec = s % 60
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

// ─── REPORTS — RELATÓRIOS E PEÇAS ─────────────────────────────────

const REPORT_TYPES = [
  ['probatorio', 'Parecer Probatório', 'Prova material, testemunhal e requisitos do benefício'],
  ['audiencia', 'Memorando de Audiência', 'Preparação estratégica para o JEF / Vara Federal'],
  ['contradicoes', 'Relatório de Contradições', 'Divergências entre CNIS, documentos e depoimentos'],
  ['resumo', 'Resumo Executivo', 'Visão geral concisa da ação previdenciária'],
  ['memoriais', 'Memoriais (alegações finais)', 'Rascunho da peça pós-instrução, com base no que foi produzido'],
  ['cliente', 'Resumo para o cliente', 'Explicação em linguagem simples para enviar ao(à) segurado(a)'],
]

/** Reúne tudo o que o sistema sabe da ação para alimentar a IA. */
function buildCaseDossier() {
  const c = state.selectedCase
  if (!c) return ''
  const parts = []
  parts.push([
    'DADOS DA AÇÃO:',
    `Processo: ${c.number || 'N/A'}`, `Título: ${c.title || 'N/A'}`, `Segurado(a): ${c.clientName || 'N/A'}`,
    `Espécie de benefício: ${c.benefit || 'N/A'}`, `NB: ${c.nb || 'N/A'}`, `DER: ${c.der || 'N/A'}`,
    `Vara / Juizado: ${c.court || 'N/A'}`, `Juiz(a): ${c.judge || 'N/A'}`, `Valor da causa: ${c.value || 'N/A'}`,
    `Próxima audiência: ${c.nextHearing || 'N/A'}`, `Status: ${c.status || 'active'}`, `Risco: ${c.riskLevel || 'não avaliado'}`,
    `Tags: ${(c.tags || []).join(', ')}`, c.notes ? `Observações: ${c.notes}` : '',
  ].filter(Boolean).join('\n'))

  const tl = timelineContextText()
  if (tl) {
    const a = analyzeTimeline()
    parts.push(tl + `\nTEMPO APURADO (estimativa por mês cheio): contribuição ${fmtMonthsSpan(a.contribMonths)}; atividade rural ${fmtMonthsSpan(a.ruralMonths)}.`)
  }

  for (const s of state.scripts) {
    const st = state.hearing[s.id]
    if (!st) continue
    const qa = s.questions.map((q, i) => {
      const ans = (st.answers?.[q.id] || '').trim()
      return ans ? `  ${i + 1}. P: ${q.text}\n     R: ${ans}${st.marks?.[q.id] ? ` [${MARKS[st.marks[q.id]]?.[0] || ''}]` : ''}` : null
    }).filter(Boolean).join('\n')
    const bloco = [
      `INSTRUÇÃO — DEPOENTE: ${s.witness}${s.role ? ' (' + s.role + ')' : ''}`,
      qa ? 'Respostas anotadas:\n' + qa : '',
      st.notes ? 'Anotações: ' + st.notes.slice(0, 1500) : '',
      st.summary ? 'Síntese: ' + st.summary.slice(0, 2500) : '',
    ].filter(Boolean).join('\n')
    if (bloco.split('\n').length > 1) parts.push(bloco)
  }
  return parts.join('\n\n').slice(0, 14000)
}

const REPORT_INSTRUCTIONS = {
  probatorio: 'Elabore um Parecer Probatório. Inclua: introdução, requisitos legais do benefício (qualidade de segurado, carência e requisito específico), análise dos fatos, análise probatória (prova material e testemunhal), pontos de risco, conclusão e recomendações para a instrução.',
  audiencia: 'Elabore um Memorando de Audiência para JEF/Vara Federal: objetivo da audiência, fatos controvertidos, prova a produzir, roteiro por depoente, riscos e como contorná-los, e checklist do que levar.',
  contradicoes: 'Elabore um Relatório de Contradições: liste divergências entre CNIS/linha do tempo, documentos e depoimentos, indicando o impacto de cada uma no pedido e como saná-la.',
  resumo: 'Elabore um Resumo Executivo conciso (até 1 página): situação, tese, provas, riscos e próximos passos.',
  memoriais: 'Redigir MEMORIAIS (alegações finais) em rascunho, com estas seções marcadas por "## ": Endereçamento (com [VARA/JUIZADO] e [Nº DO PROCESSO] se não constarem); I — Síntese da controvérsia; II — Da prova produzida (documental e oral, citando o que consta no dossiê); III — Do direito (requisitos do benefício e enquadramento dos fatos; cite apenas dispositivos legais de que tenha certeza e NÃO cite jurisprudência específica — use [INSERIR PRECEDENTE] onde couber); IV — Dos pedidos; Fechamento ([LOCAL], [DATA], [ADVOGADO/OAB]). Onde o dossiê não trouxer um fato, escreva [CONFIRMAR] em vez de inventar.',
  cliente: 'Escreva um resumo para o(a) próprio(a) segurado(a), em linguagem simples, frases curtas e tom acolhedor, sem juridiquês. Explique: o que aconteceu até agora, o que vem a seguir, o que a pessoa precisa fazer ou levar. Não prometa resultado. Até cerca de 350 palavras, com no máximo 3 títulos marcados por "## ".',
}

async function generateReport(type, caseData) {
  const meta = REPORT_TYPES.find(t => t[0] === type) || REPORT_TYPES[0]
  const label = meta[1]
  const systemPrompt = 'Você é um redator jurídico especializado em DIREITO PREVIDENCIÁRIO brasileiro (RGPS, Lei 8.213/91, Lei 8.742/93, Decreto 3.048/99, EC 103/2019). Escreva de forma formal, objetiva e bem estruturada, atento a qualidade de segurado, carência, início de prova material, enquadramento especial e incapacidade. Use APENAS os fatos do dossiê, não invente fatos nem jurisprudência, e sinalize com [CONFIRMAR] o que faltar.'
  const userPrompt = `${REPORT_INSTRUCTIONS[type] || REPORT_INSTRUCTIONS.probatorio}\n\nTítulo do documento: "${label}". Use seções marcadas por "## Título da Seção".\n\nDOSSIÊ DA AÇÃO:\n${buildCaseDossier()}`
  const content = await groqChat([{ role: 'user', content: userPrompt }], systemPrompt, { temperature: 0.4, max_tokens: type === 'memoriais' ? 4000 : 3200 })
  return { id: uid('rp'), type, label, content, generatedAt: new Date().toISOString(), caseId: caseData.id }
}

/** Converte o texto da IA (com ## e **) em HTML seguro. */
function mdToHtml(text) {
  const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  const out = []
  let inList = false
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false } }
  for (const raw of esc(text || '').split('\n')) {
    const line = raw.trimEnd()
    let m
    if ((m = line.match(/^#{1,4}\s+(.+)$/))) { closeList(); out.push(`<div class="report-section-title">${inline(m[1])}</div>`) }
    else if ((m = line.match(/^\s*[-*•]\s+(.+)$/))) { if (!inList) { out.push('<ul>'); inList = true } out.push(`<li>${inline(m[1])}</li>`) }
    else if (!line.trim()) closeList()
    else { closeList(); out.push(`<p>${inline(line)}</p>`) }
  }
  closeList()
  return out.join('')
}

function renderReports() {
  const c = state.selectedCase
  const cur = window._selectedReportType || 'probatorio'
  const a = analyzeTimeline()
  const withNotes = state.scripts.filter(s => { const st = state.hearing[s.id]; return st && (Object.values(st.answers || {}).some(Boolean) || st.notes || st.summary) }).length
  const base = (ok, txt) => `<div style="display:flex;gap:8px;font-size:12px;padding:5px 0;color:${ok ? 'var(--text-secondary)' : 'var(--text-muted)'}"><span style="color:${ok ? 'var(--risk-low)' : 'var(--text-disabled)'}">${ok ? '✓' : '○'}</span>${txt}</div>`

  set('main-content', `
    ${caseBar()}
    <div class="grid-auto" style="align-items:start">
      <div>
        <div class="card" style="padding:22px;margin-bottom:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:6px">Gerar relatório ou peça com IA</div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">A IA usa os dados da ação, a linha do tempo e as anotações da oitiva. O resultado é um rascunho: revise antes de usar.</div>
          <div class="lx-type-grid">
            ${REPORT_TYPES.map(([val, label, desc]) => `
              <button class="lx-type ${val === cur ? 'on' : ''}" data-type="${val}" onclick="selectReportType('${val}')">
                <span class="lx-type-name">${label}</span><small>${desc}</small>
              </button>`).join('')}
          </div>
          <button class="btn btn-primary" id="report-gen-btn" style="margin-top:16px" onclick="handleGenerateReport()" ${!c ? 'disabled' : ''}>Gerar com IA</button>
        </div>
        <div id="report-output">${state.reportContent && state.reportContent.caseId === c?.id ? reportResultHtml(state.reportContent) : ''}</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card" style="padding:18px">
          <div class="section-muted" style="margin-bottom:12px">O que a IA vai usar</div>
          ${c ? `
            <div style="font-size:14px;font-weight:600;margin-bottom:2px">${esc(c.title)}</div>
            <div style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:10px">${esc(c.number || '—')}</div>
            ${base(true, 'Dados da ação')}
            ${base(a.rows.length > 0, a.rows.length ? `Linha do tempo (${a.rows.length} períodos)` : 'Linha do tempo (vazia)')}
            ${base(state.scripts.length > 0, state.scripts.length ? `Roteiros (${state.scripts.length})` : 'Roteiros (nenhum)')}
            ${base(withNotes > 0, withNotes ? `Anotações da oitiva (${withNotes})` : 'Anotações da oitiva (nenhuma)')}
          ` : '<div style="color:var(--text-muted);font-size:13px">Nenhuma ação selecionada</div>'}
        </div>
        <div class="card" style="padding:18px">
          <div class="section-muted" style="margin-bottom:12px">Salvos nesta ação</div>
          ${state.reportsHistory.length ? state.reportsHistory.map(r => `
            <div class="lx-saved-row">
              <div style="min-width:0"><div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.label)}</div>
              <div style="font-size:11px;color:var(--text-muted)">${new Date(r.generatedAt).toLocaleString('pt-BR')}</div></div>
              <div style="display:flex;gap:2px;flex-shrink:0">
                <button class="btn btn-ghost btn-sm" onclick="openSavedReport('${esc(r.id)}')">Abrir</button>
                <button class="btn btn-ghost btn-sm" style="color:var(--risk-high)" onclick="deleteSavedReport('${esc(r.id)}')">✕</button>
              </div>
            </div>`).join('') : '<div style="font-size:12px;color:var(--text-muted)">Os relatórios gerados ficam guardados aqui.</div>'}
        </div>
      </div>
    </div>`)
}

window.selectReportType = function (type) {
  window._selectedReportType = type
  document.querySelectorAll('.lx-type').forEach(b => b.classList.toggle('on', b.dataset.type === type))
}

window.handleGenerateReport = async function () {
  const type = window._selectedReportType || 'probatorio'
  const c = state.selectedCase
  if (!c) { alert('Selecione uma ação antes de gerar o relatório.'); return }
  const btn = el('report-gen-btn')
  btn.disabled = true; btn.innerHTML = `${spinner()} Gerando…`
  set('report-output', `<div style="text-align:center;padding:40px">${spinner('spinner-lg')}<div style="font-size:13px;color:var(--text-muted);margin-top:16px">A IA está redigindo o documento…</div></div>`)
  try {
    const rep = await generateReport(type, c)
    state.reportContent = rep
    state.reportsHistory = [rep, ...state.reportsHistory].slice(0, 12)
    saveCaseFields(c.id, { reports: state.reportsHistory })
    renderReports()
  } catch (e) {
    set('report-output', `<div class="alert-error">${esc(e.message)}</div>`)
    btn.disabled = false; btn.textContent = 'Gerar com IA'
  }
}

function reportResultHtml(rep) {
  return `
    <div class="card fade-up" style="padding:24px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div>
          <div style="font-size:15px;font-weight:600">${esc(rep.label)}</div>
          <div style="font-size:12px;color:var(--text-muted)">Gerado em ${new Date(rep.generatedAt).toLocaleString('pt-BR')} · você pode editar o texto abaixo</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="copyReport()">Copiar</button>
          <button class="btn btn-secondary btn-sm" onclick="exportReportDoc()">Baixar Word</button>
          <button class="btn btn-ghost btn-sm" onclick="exportReport()">TXT</button>
        </div>
      </div>
      <div class="report-content lx-doc" id="report-body" contenteditable="true" spellcheck="true">${mdToHtml(rep.content)}</div>
    </div>`
}

function currentReportText() {
  return el('report-body')?.innerText?.trim() || state.reportContent?.content || ''
}

window.copyReport = async function () {
  if (await copyText(currentReportText())) alert('Texto copiado.')
}

window.exportReport = function () {
  if (!state.reportContent) return
  downloadText(`${state.reportContent.label.replace(/\s+/g, '_')}.txt`, state.reportContent.label + '\n\n' + currentReportText())
}

window.exportReportDoc = function () {
  const rep = state.reportContent
  const body = el('report-body')?.innerHTML
  if (!rep || !body) return
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(rep.label)}</title><style>body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5}h2{font-size:13pt;margin:14pt 0 6pt}p{margin:0 0 8pt;text-align:justify}</style></head><body><h1 style="font-size:14pt;text-align:center">${esc(rep.label.toUpperCase())}</h1>${body.replace(/<div class="report-section-title">(.*?)<\/div>/g, '<h2>$1</h2>')}</body></html>`
  downloadText(`${rep.label.replace(/\s+/g, '_')}.doc`, html, 'application/msword')
}

window.openSavedReport = function (id) {
  const r = state.reportsHistory.find(x => x.id === id)
  if (!r) return
  state.reportContent = r
  set('report-output', reportResultHtml(r))
  el('report-output')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

window.deleteSavedReport = function (id) {
  if (!confirm('Excluir este relatório salvo?')) return
  state.reportsHistory = state.reportsHistory.filter(x => x.id !== id)
  if (state.reportContent?.id === id) state.reportContent = null
  if (state.selectedCase) saveCaseFields(state.selectedCase.id, { reports: state.reportsHistory })
  renderReports()
}

// ─── NEW CASE ─────────────────────────────────────────────────────

function renderNewCase() {
  state.newCaseStep = state.newCaseStep || 1
  const step = state.newCaseStep
  const d = state.newCaseData || {}
  const steps = ['Dados Básicos', 'Partes', 'Benefício & Datas', 'Revisão']

  set('main-content', `
    <div style="max-width:700px;margin:0 auto">
      <div class="steps-bar" style="margin-bottom:32px">
        ${steps.map((s, i) => `
          <div class="step-item">
            <div class="step-circle ${i+1 < step ? 'done' : i+1 === step ? 'active' : ''}">${i+1 < step ? '✓' : i+1}</div>
            <div class="step-label ${i+1 === step ? 'active' : ''}">${s}</div>
          </div>`).join('')}
      </div>
      <div class="card" style="padding:32px">
        ${step === 1 ? `
          <div style="font-size:15px;font-weight:600;margin-bottom:24px">Dados Básicos da Ação</div>
          <div style="display:flex;flex-direction:column;gap:16px">
            <div class="field"><label>Título do Caso *</label><input type="text" id="nc-title" value="${d.title || ''}" placeholder="Ex.: Maria da Silva x INSS — Aposentadoria Rural" /></div>
            <div class="grid-2">
              <div class="field"><label>Número do Processo</label><input type="text" id="nc-number" value="${d.number || ''}" placeholder="0000000-00.0000.0.00.0000" /></div>
              <div class="field"><label>Espécie de Benefício</label><select id="nc-benefit">
                <option>Aposentadoria Rural / Segurado Especial</option>
                <option>Aposentadoria Especial</option>
                <option>Aposentadoria por Tempo de Contribuição</option>
                <option>Aposentadoria por Idade</option>
                <option>Auxílio por Incapacidade Temporária</option>
                <option>Aposentadoria por Incapacidade Permanente</option>
                <option>BPC / LOAS</option>
                <option>Pensão por Morte</option>
                <option>Salário-Maternidade</option>
                <option>Auxílio-Acidente</option>
                <option>Revisão de Benefício</option>
                <option>Outro</option>
              </select></div>
            </div>
            <div class="grid-2">
              <div class="field"><label>Status</label><select id="nc-status"><option value="active">Ativo</option><option value="pending">Pendente</option></select></div>
              <div class="field"><label>Nível de Risco</label><select id="nc-risk"><option value="low">Baixo</option><option value="medium">Médio</option><option value="high">Alto</option></select></div>
            </div>
            <div class="field"><label>Vara / Juizado</label><input type="text" id="nc-court" value="${d.court || ''}" placeholder="Ex.: 1º Juizado Especial Federal de Salvador/BA" /></div>
          </div>
        ` : step === 2 ? `
          <div style="font-size:15px;font-weight:600;margin-bottom:24px">Partes do Processo</div>
          <div style="display:flex;flex-direction:column;gap:16px">
            <div class="field"><label>Nome do(a) Segurado(a) *</label><input type="text" id="nc-client" value="${d.clientName || ''}" placeholder="Nome completo do(a) segurado(a)" /></div>
            <div class="field"><label>Telefone / WhatsApp do(a) segurado(a)</label><input type="text" id="nc-phone" value="${d.clientPhone || ''}" placeholder="(00) 00000-0000" inputmode="tel" /></div>
            <div class="field"><label>Nome do Juiz(a) Federal</label><input type="text" id="nc-judge" value="${d.judge || ''}" placeholder="Dr(a). Nome Sobrenome" /></div>
            <div class="field"><label>Parte Ré</label><input type="text" id="nc-opposing" value="${d.opposing || 'INSS — Instituto Nacional do Seguro Social'}" placeholder="INSS" /></div>
            <div class="field"><label>Tags (separadas por vírgula)</label><input type="text" id="nc-tags" value="${(d.tags || []).join(', ')}" placeholder="Ex.: Rural, Prova material, JEF, Perícia" /></div>
          </div>
        ` : step === 3 ? `
          <div style="font-size:15px;font-weight:600;margin-bottom:24px">Benefício, Datas e Valores</div>
          <div style="display:flex;flex-direction:column;gap:16px">
            <div class="grid-2">
              <div class="field"><label>Número do Benefício (NB)</label><input type="text" id="nc-nb" value="${d.nb || ''}" placeholder="000.000.000-0" /></div>
              <div class="field"><label>DER — Data de Entrada do Requerimento</label><input type="date" id="nc-der" value="${d.der || ''}" style="background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-md);border-radius:var(--radius-sm);padding:8px 12px;font-family:inherit" /></div>
            </div>
            <div class="field"><label>Valor da Causa</label><input type="text" id="nc-value" value="${d.value || ''}" placeholder="R$ 0,00" /></div>
            <div class="grid-2">
              <div class="field"><label>Data da Próxima Audiência</label><input type="date" id="nc-hearing" value="${d.nextHearing || ''}" style="background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-md);border-radius:var(--radius-sm);padding:8px 12px;font-family:inherit" /></div>
              <div class="field"><label>Horário</label><input type="time" id="nc-hearing-time" value="${d.nextHearingTime || ''}" style="background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-md);border-radius:var(--radius-sm);padding:8px 12px;font-family:inherit" /></div>
            </div>
            <div class="field"><label>Observações</label><textarea id="nc-notes" placeholder="Ex.: motivo do indeferimento administrativo, perícia já designada, documentos pendentes…">${d.notes || ''}</textarea></div>
          </div>
        ` : `
          <div style="font-size:15px;font-weight:600;margin-bottom:24px">Revisão do Caso</div>
          ${Object.entries({ 'Título': d.title, 'Processo': d.number, 'Segurado(a)': d.clientName, 'Benefício': d.benefit, 'NB': d.nb, 'DER': d.der, 'Vara / Juizado': d.court, 'Juiz(a)': d.judge, 'Parte Ré': d.opposing, 'Valor da causa': d.value, 'Status': fmt.status(d.status), 'Risco': fmt.risk(d.riskLevel), 'Tags': (d.tags || []).join(', ') }).filter(([,v]) => v).map(([l, v]) => `
            <div style="display:flex;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px">
              <div style="width:120px;color:var(--text-muted);flex-shrink:0">${l}</div>
              <div style="font-weight:500">${v}</div>
            </div>`).join('')}
        `}
        <div style="display:flex;justify-content:space-between;margin-top:28px;padding-top:20px;border-top:1px solid var(--border)">
          <button class="btn btn-ghost" onclick="newCaseNav(-1)">${step === 1 ? 'Cancelar' : '← Anterior'}</button>
          ${step < 4
            ? `<button class="btn btn-primary" onclick="newCaseNav(1)">Próximo →</button>`
            : `<button class="btn btn-primary" id="nc-submit-btn" onclick="submitNewCase()">Criar Caso</button>`
          }
        </div>
      </div>
    </div>
  `)
}

window.newCaseNav = function(dir) {
  if (dir === -1 && state.newCaseStep === 1) { state.newCaseStep = 1; state.newCaseData = {}; navigate('cases', document.querySelector('.nav-item[data-page="cases"]')); return }
  const d = state.newCaseData
  if (state.newCaseStep === 1) {
    d.title = el('nc-title')?.value; d.number = el('nc-number')?.value; d.status = el('nc-status')?.value; d.riskLevel = el('nc-risk')?.value; d.court = el('nc-court')?.value; d.benefit = el('nc-benefit')?.value
    if (dir === 1 && !d.title?.trim()) { alert('Informe o título do caso.'); return }
  } else if (state.newCaseStep === 2) {
    d.clientName = el('nc-client')?.value; d.clientPhone = el('nc-phone')?.value; d.judge = el('nc-judge')?.value; d.opposing = el('nc-opposing')?.value
    const tagsRaw = el('nc-tags')?.value || ''
    d.tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
    if (dir === 1 && !d.clientName?.trim()) { alert('Informe o nome do(a) segurado(a).'); return }
  } else if (state.newCaseStep === 3) {
    d.value = el('nc-value')?.value; d.nextHearing = el('nc-hearing')?.value || null; d.nextHearingTime = el('nc-hearing-time')?.value || ''; d.notes = el('nc-notes')?.value; d.nb = el('nc-nb')?.value; d.der = el('nc-der')?.value || null
  }
  state.newCaseStep = Math.max(1, Math.min(4, state.newCaseStep + dir))
  renderNewCase()
}

window.submitNewCase = async function() {
  const btn = el('nc-submit-btn')
  btn.disabled = true; btn.innerHTML = `${spinner()} Criando…`
  try {
    let c
    if (!state.fbReady) {
      // Modo demo: salva localmente na sessão
      c = { id: 'local-' + Date.now(), ...state.newCaseData, createdAt: new Date().toISOString(), completionPct: 0, aiAlerts: 0, documents: 0, status: state.newCaseData.status || 'active' }
    } else {
      c = await createCase({ ...state.newCaseData, createdAt: new Date().toISOString(), completionPct: 0, aiAlerts: 0, documents: 0 })
    }
    state.cases.unshift(c)
    setSelectedCase(c)
    updateAgendaBadge()
    state.newCaseStep = 1; state.newCaseData = {}
    navigate('case-detail', null)
  } catch (e) { alert('Erro ao criar caso: ' + e.message); btn.disabled = false; btn.textContent = 'Criar Caso' }
}

// ─── SETTINGS ─────────────────────────────────────────────────────

function renderSettings() {
  const cfg = loadConfig()
  const fbOk = state.fbReady
  set('main-content', `
    <div style="max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:24px">

      <div class="alert-info" style="font-size:13px">
        <strong>Como configurar:</strong> Crie um projeto no <a href="https://console.firebase.google.com" target="_blank" style="color:var(--accent-blue)">Firebase Console</a>, ative Authentication (e-mail/senha), Firestore e Storage. Cole as credenciais abaixo e clique em Salvar.
      </div>

      <div class="card" style="padding:28px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
          <div style="width:40px;height:40px;border-radius:var(--radius-md);background:rgba(255,160,0,0.12);display:flex;align-items:center;justify-content:center;">🔥</div>
          <div>
            <div style="font-size:15px;font-weight:600">Firebase</div>
            <div style="font-size:12px;color:var(--text-muted)">Autenticação, banco de dados e armazenamento de arquivos</div>
          </div>
          ${fbOk ? '<span class="badge badge-teal" style="margin-left:auto">✓ Conectado</span>' : '<span class="badge badge-neutral" style="margin-left:auto">Não configurado</span>'}
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="grid-2">
            <div class="field"><label>API Key *</label><input type="password" id="cfg-fb-key" value="${cfg.firebaseApiKey || ''}" placeholder="AIzaSy…" style="font-family:var(--font-mono);font-size:12px" /></div>
            <div class="field"><label>Project ID *</label><input type="text" id="cfg-fb-pid" value="${cfg.firebaseProjectId || ''}" placeholder="meu-projeto-12345" style="font-family:var(--font-mono);font-size:12px" /></div>
          </div>
          <div class="grid-2">
            <div class="field"><label>Auth Domain</label><input type="text" id="cfg-fb-auth" value="${cfg.firebaseAuthDomain || ''}" placeholder="projeto.firebaseapp.com" style="font-family:var(--font-mono);font-size:12px" /></div>
            <div class="field"><label>App ID</label><input type="password" id="cfg-fb-appid" value="${cfg.firebaseAppId || ''}" placeholder="1:000000:web:abc…" style="font-family:var(--font-mono);font-size:12px" /></div>
          </div>
          <div class="field"><label>Storage Bucket (obrigatório para upload de arquivos)</label><input type="text" id="cfg-fb-bucket" value="${cfg.firebaseStorageBucket || ''}" placeholder="projeto.appspot.com" style="font-family:var(--font-mono);font-size:12px" /></div>
          <div class="field"><label>Messaging Sender ID</label><input type="text" id="cfg-fb-sender" value="${cfg.firebaseMessagingSenderId || ''}" placeholder="000000000000" style="font-family:var(--font-mono);font-size:12px" /></div>
        </div>
      </div>

      <div class="card" style="padding:28px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
          <div style="width:40px;height:40px;border-radius:var(--radius-md);background:var(--accent-blue-subtle);display:flex;align-items:center;justify-content:center;color:var(--accent-blue)">⚡</div>
          <div>
            <div style="font-size:15px;font-weight:600">Groq AI</div>
            <div style="font-size:12px;color:var(--text-muted)">Motor de IA para roteiros previdenciários, análises e relatórios</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="field"><label>API Key * — obtenha em <a href="https://console.groq.com" target="_blank" style="color:var(--accent-blue)">console.groq.com</a></label><input type="password" id="cfg-groq-key" value="${cfg.groqApiKey || ''}" placeholder="gsk_…" style="font-family:var(--font-mono);font-size:12px" /></div>
          <div class="field">
            <label>Modelo</label>
            <select id="cfg-groq-model">
              ${[
                ['openai/gpt-oss-120b','openai/gpt-oss-120b (Recomendado)'],
                ['openai/gpt-oss-20b','openai/gpt-oss-20b (Rápido)'],
                ['qwen/qwen3.6-27b','qwen/qwen3.6-27b'],
                ['moonshotai/kimi-k2-instruct-0905','moonshotai/kimi-k2-instruct-0905'],
              ].map(([v,l]) => `<option value="${v}" ${getGroqModel()===v?'selected':''}>${l}</option>`).join('')}
            </select>
          </div>
          <div id="groq-test-result"></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-secondary" id="groq-test-btn" onclick="testGroq()">Testar conexão Groq</button>
            <button class="btn btn-ghost" id="groq-list-btn" onclick="loadGroqModels()">Carregar modelos da minha conta</button>
          </div>
        </div>
      </div>

      <div class="card" style="padding:28px">
        <div style="font-size:15px;font-weight:600;margin-bottom:20px">Dados do Escritório</div>
        <div class="grid-2">
          <div class="field"><label>Nome do escritório</label><input type="text" id="cfg-firm" value="${cfg.firmName || ''}" placeholder="Monteiro & Associados" /></div>
          <div class="field"><label>Responsável</label><input type="text" id="cfg-name" value="${cfg.userName || ''}" placeholder="Dr. Rafael Monteiro" /></div>
        </div>
      </div>

      <div style="display:flex;gap:12px;justify-content:flex-end;align-items:center">
        <span id="cfg-saved" style="font-size:13px;color:var(--risk-low);display:none">✓ Configurações salvas!</span>
        <button class="btn btn-primary" id="cfg-save-btn" onclick="saveSettings()">Salvar Configurações</button>
      </div>
    </div>
  `)
}

window.testGroq = async function() {
  const key = el('cfg-groq-key')?.value?.trim()
  const model = el('cfg-groq-model')?.value
  const btn = el('groq-test-btn')
  btn.disabled = true; btn.innerHTML = `${spinner()} Testando…`
  set('groq-test-result', '')
  try {
    const res = await groqChat([{ role: 'user', content: 'Responda apenas: OK' }], 'Responda somente: OK', { apiKey: key, model })
    set('groq-test-result', `<div style="background:var(--risk-low-subtle);border:1px solid rgba(34,197,94,0.2);border-radius:var(--radius-sm);padding:8px 12px;font-size:12px;color:var(--risk-low)">✓ Groq conectado! Modelo: ${model}. Resposta: ${res.trim()}</div>`)
  } catch (e) {
    // Se o modelo não existe, mostra os que a conta realmente tem
    let extra = ''
    try {
      const ids = await listGroqModels(key)
      extra = ids.length
        ? `<div style="margin-top:8px;color:var(--text-secondary)">Modelos disponíveis na sua conta:<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${ids.map(id => `<button class="btn btn-ghost btn-sm" style="font-family:var(--font-mono);font-size:11px;padding:2px 8px" onclick="useGroqModel('${id}')">${id}</button>`).join('')}</div><div style="margin-top:6px;font-size:11px;color:var(--text-muted)">Clique em um para selecioná-lo.</div></div>`
        : ''
    } catch (e2) {
      extra = `<div style="margin-top:8px;color:var(--text-muted)">Não foi possível listar os modelos: ${e2.message}</div>`
    }
    set('groq-test-result', `<div style="background:var(--risk-high-subtle);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-sm);padding:10px 12px;font-size:12px;color:var(--risk-high)">✗ Erro com o modelo <span style="font-family:var(--font-mono)">${model}</span>: ${e.message}${extra}</div>`)
  }
  btn.disabled = false; btn.textContent = 'Testar conexão Groq'
}

window.useGroqModel = function(id) {
  const sel = el('cfg-groq-model')
  if (!sel) return
  if (!Array.from(sel.options).some(o => o.value === id)) {
    sel.appendChild(new Option(id, id))
  }
  sel.value = id
  window.saveSettings()
  set('groq-test-result', `<div style="background:var(--accent-blue-subtle);border:1px solid var(--accent-blue-border);border-radius:var(--radius-sm);padding:8px 12px;font-size:12px;color:var(--accent-blue)">Modelo <span style="font-family:var(--font-mono)">${id}</span> selecionado e salvo. Clique em "Testar conexão Groq".</div>`)
}

window.loadGroqModels = async function() {
  const btn = el('groq-list-btn')
  const key = el('cfg-groq-key')?.value?.trim()
  btn.disabled = true; btn.innerHTML = `${spinner()} Carregando…`
  try {
    const ids = await listGroqModels(key)
    const sel = el('cfg-groq-model')
    const atual = sel.value
    sel.innerHTML = ids.map(id => `<option value="${id}" ${id===atual?'selected':''}>${id}</option>`).join('')
    if (!ids.includes(atual) && ids.length) sel.value = ids[0]
    set('groq-test-result', `<div style="background:var(--risk-low-subtle);border:1px solid rgba(34,197,94,0.2);border-radius:var(--radius-sm);padding:8px 12px;font-size:12px;color:var(--risk-low)">✓ ${ids.length} modelo(s) carregado(s) da sua conta. Escolha um e salve.</div>`)
  } catch (e) {
    set('groq-test-result', `<div style="background:var(--risk-high-subtle);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-sm);padding:8px 12px;font-size:12px;color:var(--risk-high)">✗ ${e.message}</div>`)
  }
  btn.disabled = false; btn.textContent = 'Carregar modelos da minha conta'
}

window.saveSettings = function() {
  const cfg = {
    firebaseApiKey: el('cfg-fb-key')?.value,
    firebaseProjectId: el('cfg-fb-pid')?.value,
    firebaseAuthDomain: el('cfg-fb-auth')?.value,
    firebaseAppId: el('cfg-fb-appid')?.value,
    firebaseStorageBucket: el('cfg-fb-bucket')?.value,
    firebaseMessagingSenderId: el('cfg-fb-sender')?.value,
    groqApiKey: el('cfg-groq-key')?.value,
    groqModel: el('cfg-groq-model')?.value,
    firmName: el('cfg-firm')?.value,
    userName: el('cfg-name')?.value,
  }
  saveConfig(cfg)
  initFirebase()
  el('cfg-saved').style.display = 'inline'
  setTimeout(() => el('cfg-saved').style.display = 'none', 3000)
  if (state.currentUser) {
    set('sidebar-user-name', cfg.userName || state.currentUser.name)
  }
}

// ─── CHAT WIDGET ──────────────────────────────────────────────────

// ─── MOBILE SIDEBAR ───────────────────────────────────────────────

window.openSidebar = function() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebar-overlay')
  if (sidebar) sidebar.classList.add('open')
  if (overlay) overlay.classList.add('active')
  document.body.style.overflow = 'hidden'
}

window.closeSidebar = function() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebar-overlay')
  if (sidebar) sidebar.classList.remove('open')
  if (overlay) overlay.classList.remove('active')
  document.body.style.overflow = ''
}

// Close sidebar on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') window.closeSidebar()
})

// Swipe-to-open sidebar (touch gesture — drag right from left edge)
;(function setupSwipe() {
  let startX = 0, startY = 0, tracking = false
  document.addEventListener('touchstart', e => {
    const t = e.touches[0]
    startX = t.clientX; startY = t.clientY
    tracking = startX < 30 // only trigger from left edge (0-30px)
  }, { passive: true })

  document.addEventListener('touchmove', e => {
    if (!tracking) return
    const dx = e.touches[0].clientX - startX
    const dy = Math.abs(e.touches[0].clientY - startY)
    if (dx > 50 && dy < 60) {
      tracking = false
      window.openSidebar()
    }
  }, { passive: true })
})()

window.toggleChat = function() {
  const box = el('chat-box')
  box.style.display = box.style.display === 'none' ? 'flex' : 'none'
  const fab = el('chat-fab')
  if (box.style.display !== 'none') {
    fab.style.background = 'var(--bg-elevated)'
    fab.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><line x1="18" y1="6" x2="6" y2="18" stroke="var(--text-secondary)" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="6" x2="18" y2="18" stroke="var(--text-secondary)" stroke-width="2" stroke-linecap="round"/></svg>`
    set('chat-subtitle', state.selectedCase ? state.selectedCase.title : 'Assistente jurídica')
  } else {
    fab.style.background = 'var(--accent-blue)'
    fab.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2a2 2 0 0 1 2 2v.5a.5.5 0 0 0 .5.5H16a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-1.5a.5.5 0 0 0-.5.5V12" stroke="white" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="15" r="3" stroke="white" stroke-width="1.5"/><path d="M12 18v4" stroke="white" stroke-width="1.5" stroke-linecap="round"/><path d="M9 15H5" stroke="white" stroke-width="1.5" stroke-linecap="round"/><path d="M19 15h-4" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>`
  }
}

window.sendChat = async function() {
  const input = el('chat-input')
  const msg = input?.value?.trim()
  if (!msg || state.chatLoading) return
  input.value = ''
  appendChatMsg('user', msg)
  state.chatHistory.push({ role: 'user', content: msg })
  state.chatLoading = true
  const loadingId = appendChatMsg('assistant', `${spinner()}`, true)

  try {
    const caseCtx = state.selectedCase ? { title: state.selectedCase.title, client: state.selectedCase.clientName, risk: state.selectedCase.riskLevel } : null
    const reply = await chatWithAI(msg, state.chatHistory, caseCtx)
    state.chatHistory.push({ role: 'assistant', content: reply })
    const loadingMsg = el(loadingId)
    if (loadingMsg) loadingMsg.querySelector('.chat-bubble').textContent = reply
  } catch (e) {
    const loadingMsg = el(loadingId)
    if (loadingMsg) loadingMsg.querySelector('.chat-bubble').innerHTML = `<span style="color:var(--risk-high);font-size:12px">${e.message}</span>`
  }
  state.chatLoading = false
  scrollChat()
}

function appendChatMsg(role, html, isTemp = false) {
  const id = 'msg_' + Date.now()
  const msgs = el('chat-messages')
  if (!msgs) return id
  const div = document.createElement('div')
  div.id = id; div.className = `chat-msg ${role}`
  div.innerHTML = `<div class="chat-bubble">${html}</div>`
  msgs.appendChild(div)
  scrollChat()
  return id
}

function scrollChat() {
  const msgs = el('chat-messages')
  if (msgs) msgs.scrollTop = msgs.scrollHeight
}

// ─── AGENDA DO ESCRITÓRIO ─────────────────────────────────────────
// Audiências vêm do campo "próxima audiência" de cada ação; prazos e demais
// compromissos ficam em case.deadlines (gravados junto com a ação).

const EVENT_TYPES = {
  prazo: ['Prazo processual', 'badge-risk-high'],
  audiencia: ['Audiência', 'badge-blue'],
  pericia: ['Perícia', 'badge-gold'],
  diligencia: ['Diligência', 'badge-teal'],
  reuniao: ['Reunião com cliente', 'badge-purple'],
  outro: ['Outro', 'badge-neutral'],
}

if (!state.agendaFilter) state.agendaFilter = 'all'

function collectEvents() {
  const ev = []
  for (const c of state.cases) {
    if (c.nextHearing) ev.push({ id: 'h-' + c.id, caseId: c.id, kind: 'audiencia', title: 'Audiência', date: c.nextHearing, time: c.nextHearingTime || '', notes: '', done: false, derived: true })
    for (const d of (c.deadlines || [])) ev.push({ ...d, caseId: c.id })
  }
  return ev.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
}

function bucketOf(e) {
  const d = daysUntil(e.date)
  if (e.done) return 'done'
  if (d < 0) return e.kind === 'audiencia' ? 'done' : 'overdue'
  if (d === 0) return 'today'
  if (d <= 7) return 'week'
  if (d <= 30) return 'month'
  return 'later'
}

const BUCKETS = [
  ['overdue', 'Atrasados', 'var(--risk-high)'],
  ['today', 'Hoje', 'var(--accent-blue)'],
  ['week', 'Próximos 7 dias', 'var(--text-primary)'],
  ['month', 'Próximos 30 dias', 'var(--text-secondary)'],
  ['later', 'Mais adiante', 'var(--text-muted)'],
  ['done', 'Concluídos e passados', 'var(--text-muted)'],
]

function daysLabel(e) {
  const d = daysUntil(e.date)
  if (e.done) return 'Concluído'
  if (d < 0) return `${-d} dia${-d > 1 ? 's' : ''} de atraso`
  if (d === 0) return 'Hoje'
  if (d === 1) return 'Amanhã'
  return `em ${d} dias`
}

function updateAgendaBadge() {
  const b = el('nav-badge-agenda')
  if (!b) return
  const ev = collectEvents()
  const overdue = ev.filter(e => bucketOf(e) === 'overdue').length
  const today = ev.filter(e => bucketOf(e) === 'today').length
  const n = overdue + today
  b.style.display = n > 0 ? 'inline-block' : 'none'
  b.textContent = n
  b.className = 'nav-badge-count' + (overdue > 0 ? ' danger' : '')
  b.title = `${overdue} atrasado(s), ${today} para hoje`
}

function eventRow(e, compact = false) {
  const c = state.cases.find(x => x.id === e.caseId)
  const [kindLabel, kindBadge] = EVENT_TYPES[e.kind] || EVENT_TYPES.outro
  const bucket = bucketOf(e)
  const [y, m, d] = e.date.split('-')
  const mon = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][parseInt(m) - 1]
  const canRemind = ['audiencia', 'pericia', 'reuniao', 'diligencia'].includes(e.kind)
  return `
    <div class="lx-event ${bucket}">
      <div class="lx-event-date"><b>${d}</b><span>${mon}</span></div>
      <div class="lx-event-main">
        <div class="lx-event-title ${e.done ? 'done' : ''}">${esc(e.title || kindLabel)} <span class="badge ${kindBadge}">${kindLabel}</span></div>
        <div class="lx-event-sub">${esc(c?.title || 'Ação removida')}${c?.clientName ? ' · ' + esc(c.clientName) : ''}${e.time ? ' · ' + esc(e.time) : ''}${e.kind === 'audiencia' && c?.court ? ' · ' + esc(c.court) : ''}</div>
        ${e.notes ? `<div class="lx-event-notes">${esc(e.notes)}</div>` : ''}
      </div>
      <div class="lx-event-side">
        <span class="lx-days ${bucket}">${daysLabel(e)}</span>
        <div class="lx-event-actions">
          <button class="btn btn-ghost btn-sm" onclick="openEventCase('${esc(e.caseId)}')">Abrir ação</button>
          ${compact ? '' : canRemind && !e.done ? `<button class="btn btn-ghost btn-sm" onclick="remindClient('${esc(e.caseId)}','${esc(e.id)}')">WhatsApp</button>` : ''}
          ${!e.derived && !compact ? `<button class="btn btn-ghost btn-sm" onclick="toggleAgendaDone('${esc(e.caseId)}','${esc(e.id)}')">${e.done ? 'Reabrir' : '✓ Concluir'}</button>
                          <button class="btn btn-ghost btn-sm" style="color:var(--risk-high)" onclick="deleteAgendaEvent('${esc(e.caseId)}','${esc(e.id)}')">✕</button>` : ''}
        </div>
      </div>
    </div>`
}

function renderAgenda() {
  const all = collectEvents()
  const f = state.agendaFilter
  const events = all.filter(e => f === 'all' || e.kind === f)
  const count = k => all.filter(e => bucketOf(e) === k).length
  const hearings30 = all.filter(e => e.kind === 'audiencia' && bucketOf(e) !== 'done' && daysUntil(e.date) <= 30).length
  const dateStyle = 'background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-md);border-radius:var(--radius-sm);padding:8px 12px;font-family:inherit;width:100%'

  const groups = BUCKETS.map(([key, label, color]) => {
    const items = events.filter(e => bucketOf(e) === key)
    if (!items.length) return ''
    if (key === 'done' && !state.agendaShowDone) return `<div class="lx-group-head" style="color:${color}">${label} <span>${items.length}</span> <button class="btn btn-ghost btn-sm" onclick="toggleAgendaDoneList()">mostrar</button></div>`
    return `<div class="lx-group-head" style="color:${color}">${label} <span>${items.length}</span>${key === 'done' ? ' <button class="btn btn-ghost btn-sm" onclick="toggleAgendaDoneList()">ocultar</button>' : ''}</div>${items.map(e => eventRow(e)).join('')}`
  }).join('')

  set('main-content', `
    <div class="grid-4" style="margin-bottom:20px">
      ${metricCard('Atrasados', count('overdue'), 'Prazos vencidos', 'var(--risk-high)')}
      ${metricCard('Hoje', count('today'), 'Compromissos do dia', 'var(--accent-blue)')}
      ${metricCard('Próximos 7 dias', count('week'), 'Prazos e eventos', 'var(--risk-med)')}
      ${metricCard('Audiências em 30 dias', hearings30, 'Preparar roteiros', 'var(--accent-teal)')}
    </div>

    <div class="page-actions">
      <div class="lx-chips" style="margin:0">
        ${[['all', 'Tudo'], ['audiencia', 'Audiências'], ['prazo', 'Prazos'], ['pericia', 'Perícias'], ['diligencia', 'Diligências'], ['reuniao', 'Reuniões']].map(([k, l]) => `<button class="lx-chip ${f === k ? 'active' : ''}" onclick="setAgendaFilter('${k}')">${l}</button>`).join('')}
      </div>
      <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="toggleAgendaForm()">+ Novo compromisso</button>
    </div>

    ${state.agendaFormOpen ? `
      <div class="card fade-up" style="padding:20px;margin-bottom:20px;border:1px solid var(--accent-blue-border)">
        <div class="grid-2" style="gap:12px;margin-bottom:12px">
          <div class="field"><label>Tipo</label>
            <select id="ag-kind">${Object.entries(EVENT_TYPES).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Ação</label>
            <select id="ag-case">${state.cases.length ? state.cases.map(c => `<option value="${esc(c.id)}" ${state.selectedCase?.id === c.id ? 'selected' : ''}>${esc(c.title)}${c.clientName ? ' — ' + esc(c.clientName) : ''}</option>`).join('') : '<option value="">Cadastre uma ação primeiro</option>'}</select>
          </div>
        </div>
        <div class="field" style="margin-bottom:12px"><label>Descrição *</label><input type="text" id="ag-title" placeholder="Ex.: Prazo para réplica, perícia médica, juntar PPP…" /></div>
        <div class="grid-2" style="gap:12px;margin-bottom:12px">
          <div class="field"><label>Data *</label><input type="date" id="ag-date" style="${dateStyle}" /></div>
          <div class="field"><label>Horário (opcional)</label><input type="time" id="ag-time" style="${dateStyle}" /></div>
        </div>
        <div class="field" style="margin-bottom:14px"><label>Observação</label><input type="text" id="ag-notes" placeholder="Local, providência, documento a juntar…" /></div>
        <div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="addAgendaEvent()">Salvar na agenda</button><button class="btn btn-ghost btn-sm" onclick="toggleAgendaForm()">Cancelar</button></div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:10px">Ao escolher "Audiência", a data passa a ser a próxima audiência da ação.</div>
      </div>` : ''}

    ${all.length === 0 ? `
      <div class="card"><div class="empty-state"><div class="empty-icon">🗓️</div><div class="empty-title">Agenda vazia</div>
      <div class="empty-desc">Cadastre audiências nas ações ou adicione prazos e compromissos aqui.</div></div></div>`
    : events.length === 0 ? `<div class="card"><div class="empty-state"><div class="empty-title">Nada neste filtro</div></div></div>` : groups}
  `)
  updateAgendaBadge()
}

window.setAgendaFilter = function (k) { state.agendaFilter = k; renderAgenda() }
window.toggleAgendaForm = function () { state.agendaFormOpen = !state.agendaFormOpen; renderAgenda() }
window.toggleAgendaDoneList = function () { state.agendaShowDone = !state.agendaShowDone; renderAgenda() }

window.addAgendaEvent = function () {
  const kind = el('ag-kind')?.value || 'prazo'
  const caseId = el('ag-case')?.value
  const title = el('ag-title')?.value.trim()
  const date = el('ag-date')?.value
  const time = el('ag-time')?.value || ''
  const notes = el('ag-notes')?.value.trim() || ''
  if (!caseId) { alert('Cadastre e escolha uma ação primeiro.'); return }
  if (!title || !date) { alert('Preencha a descrição e a data.'); return }
  if (kind === 'audiencia') {
    const c = state.cases.find(x => x.id === caseId)
    if (c?.nextHearing && c.nextHearing !== date && !confirm(`Esta ação já tem audiência em ${fmtBR(c.nextHearing)}. Substituir por ${fmtBR(date)}?`)) return
    saveCaseFields(caseId, { nextHearing: date, nextHearingTime: time }, { immediate: true })
  } else {
    const c = state.cases.find(x => x.id === caseId)
    const list = [...(c?.deadlines || []), { id: uid('dl'), kind, title, date, time, notes, done: false }]
    saveCaseFields(caseId, { deadlines: list }, { immediate: true })
  }
  state.agendaFormOpen = false
  renderAgenda()
}

window.toggleAgendaDone = function (caseId, id) {
  const c = state.cases.find(x => x.id === caseId)
  if (!c) return
  saveCaseFields(caseId, { deadlines: (c.deadlines || []).map(d => (d.id === id ? { ...d, done: !d.done } : d)) }, { immediate: true })
  renderAgenda()
}

window.deleteAgendaEvent = function (caseId, id) {
  if (!confirm('Excluir este compromisso?')) return
  const c = state.cases.find(x => x.id === caseId)
  if (!c) return
  saveCaseFields(caseId, { deadlines: (c.deadlines || []).filter(d => d.id !== id) }, { immediate: true })
  renderAgenda()
}

window.openEventCase = function (caseId) { selectCase(caseId) }

function reminderText(c, e) {
  const first = (c.clientName || '').trim().split(/\s+/)[0]
  const firm = loadConfig().firmName
  const what = { audiencia: 'audiência', pericia: 'perícia', reuniao: 'nossa reunião', diligencia: 'diligência' }[e.kind] || 'compromisso'
  const when = `${fmtBR(e.date)}${e.time ? ' às ' + e.time : ''}`
  const docs = ['audiencia', 'pericia'].includes(e.kind) ? ' Leve um documento de identificação com foto (original) e os documentos que combinamos, e chegue com 30 minutos de antecedência.' : ''
  const local = e.kind === 'audiencia' && c.court ? ` Local: ${c.court}.` : ''
  return `Olá${first ? ', ' + first : ''}! ${firm ? 'Aqui é do escritório ' + firm + '. ' : ''}Passando para lembrar da ${what}${c.number ? ' do processo ' + c.number : ''} no dia ${when}.${local}${docs} Qualquer dúvida, é só me chamar.`
}

function whatsappUrl(phone, text) {
  let digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

window.remindClient = function (caseId, id) {
  const c = state.cases.find(x => x.id === caseId)
  const e = collectEvents().find(x => x.caseId === caseId && x.id === id)
  if (!c || !e) return
  if (!c.clientPhone) alert('Esta ação não tem telefone do(a) cliente. O WhatsApp vai abrir para você escolher o contato. Para preencher direto, use "Editar Caso".')
  window.open(whatsappUrl(c.clientPhone, reminderText(c, e)), '_blank')
}

function agendaWidget() {
  const upcoming = collectEvents().filter(e => bucketOf(e) !== 'done').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)
  return `
    <div class="card" style="overflow:hidden;margin-bottom:20px">
      <div style="padding:18px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <span class="section-title">Agenda — o que vem aí</span>
        <button class="btn btn-ghost btn-sm" onclick="navigate('agenda',null)">Abrir agenda →</button>
      </div>
      ${upcoming.length ? upcoming.map(e => eventRow(e, true)).join('') : `<div class="empty-state" style="padding:28px 20px"><div class="empty-title">Sem compromissos à vista</div><div class="empty-desc">Cadastre a data da audiência nas ações ou adicione prazos na agenda.</div></div>`}
    </div>`
}

// ─── CHECKLIST DE DOCUMENTOS POR TIPO DE BENEFÍCIO ────────────────

const CHECKLISTS = {
  rural: ['Documento de identificação com foto e CPF', 'Comprovantes de residência (atual e antigos)', 'Certidões de casamento e nascimento dos filhos com profissão de lavrador(a)', 'Autodeclaração do segurado especial e histórico da atividade rural', 'Documentos da terra: contrato de arrendamento, parceria ou comodato, ITR, escritura ou declaração de posse', 'Notas fiscais de produtor, talão de produtor e comprovantes de venda da produção', 'Declaração ou ficha do sindicato rural', 'Fichas escolares e cartões de vacina dos filhos (endereço rural)', 'CNIS e processo administrativo (indeferimento)', 'Rol de testemunhas (nome, CPF e endereço)'],
  especial: ['Documento de identificação com foto e CPF', 'CTPS de todos os vínculos', 'CNIS atualizado', 'PPP de cada empregador do período especial', 'LTCAT e laudos ambientais', 'Formulários antigos (SB-40, DSS-8030) para períodos antigos', 'Comprovantes de entrega de EPI e CA', 'Processo administrativo e contagem de tempo do INSS', 'Rol de testemunhas, se necessário'],
  tempo: ['Documento de identificação com foto e CPF', 'CTPS de todos os vínculos', 'CNIS atualizado', 'Carnês ou guias de recolhimento (GPS/DAS)', 'Certidões de tempo de contribuição, se houver', 'Sentenças e acordos trabalhistas (reclamatória)', 'Processo administrativo e contagem de tempo do INSS'],
  idade: ['Documento de identificação com foto e CPF', 'CNIS atualizado', 'CTPS', 'Carnês ou guias de recolhimento', 'Processo administrativo e contagem de tempo do INSS'],
  incapacidade: ['Documento de identificação com foto e CPF', 'Laudos e atestados médicos recentes, com CID e limitações descritas', 'Exames, prontuário e receituários', 'Comunicados de perícia e indeferimento do INSS', 'CNIS e CTPS (qualidade de segurado e carência)', 'CAT e documentos do acidente, se for o caso', 'Comprovantes de tentativas de retorno ao trabalho ou afastamento'],
  bpc: ['Documento de identificação com foto e CPF de todos do grupo familiar', 'CadÚnico atualizado', 'Comprovantes de renda do grupo familiar (ou declaração de ausência)', 'Comprovantes de despesas: aluguel, água, luz, medicamentos', 'Laudos médicos que comprovem a deficiência, ou prova de idade a partir de 65 anos', 'Fotos da residência', 'Processo administrativo e comunicado de indeferimento'],
  pensao: ['Certidão de óbito', 'Documento de identificação do(a) falecido(a) e do(a) requerente', 'CNIS e CTPS do(a) falecido(a) (qualidade de segurado)', 'Certidão de casamento ou provas de união estável', 'Comprovantes de residência em comum, contas conjuntas, filhos em comum', 'Provas de dependência econômica, quando exigida', 'Processo administrativo'],
  maternidade: ['Documento de identificação com foto e CPF', 'Certidão de nascimento, termo de guarda ou adoção', 'CNIS e CTPS', 'Comprovantes da atividade (rural ou urbana) e das contribuições', 'Processo administrativo e comunicado de indeferimento'],
  acidente: ['Documento de identificação com foto e CPF', 'CAT e documentos do acidente', 'Laudos que descrevam a sequela e a redução da capacidade', 'Exames e prontuário', 'CNIS e CTPS', 'Processo administrativo'],
  revisao: ['Carta de concessão e memória de cálculo', 'CNIS atualizado', 'Processo administrativo completo', 'Documentos dos períodos ou salários controvertidos', 'CTPS e comprovantes de contribuição'],
  outro: ['Documento de identificação com foto e CPF', 'Comprovante de residência', 'CNIS atualizado', 'Processo administrativo', 'Procuração e declaração de hipossuficiência'],
}

function checklistKey(c) {
  const b = (c?.benefit || '').toLowerCase()
  if (b.includes('rural')) return 'rural'
  if (b.includes('especial')) return 'especial'
  if (b.includes('incapacidade')) return 'incapacidade'
  if (b.includes('bpc') || b.includes('loas')) return 'bpc'
  if (b.includes('pens')) return 'pensao'
  if (b.includes('matern')) return 'maternidade'
  if (b.includes('acidente')) return 'acidente'
  if (b.includes('revis')) return 'revisao'
  if (b.includes('tempo')) return 'tempo'
  if (b.includes('idade')) return 'idade'
  return 'outro'
}

function checklistItems(c) {
  const key = checklistKey(c)
  const base = CHECKLISTS[key].map((text, i) => ({ id: `${key}:${i}`, text, custom: false }))
  const custom = (c.checklistCustom || []).map(x => ({ id: x.id, text: x.text, custom: true }))
  return [...base, ...custom]
}

function renderChecklistTab(c) {
  const items = checklistItems(c)
  const done = items.filter(i => c.checklist?.[i.id]).length
  const pct = items.length ? Math.round((done / items.length) * 100) : 0
  return `
    <div style="max-width:760px">
      <div class="card" style="padding:18px;margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
          <div>
            <div style="font-size:14px;font-weight:600">Documentos do caso</div>
            <div style="font-size:12px;color:var(--text-muted)">Lista sugerida para: ${esc(c.benefit || 'ação previdenciária')}. O progresso da ação é calculado por este checklist.</div>
          </div>
          <div style="font-size:24px;font-weight:700;color:var(--accent-blue)">${pct}%</div>
        </div>
        ${progressBar(pct, 'var(--accent-blue)', 6)}
        <div style="font-size:12px;color:var(--text-muted);margin-top:8px">${done} de ${items.length} documentos reunidos</div>
      </div>
      <div class="card" style="padding:10px 8px;margin-bottom:14px">
        ${items.map(i => `
          <label class="ic-check-item" style="justify-content:space-between">
            <span style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
              <input type="checkbox" ${c.checklist?.[i.id] ? 'checked' : ''} onchange="toggleChecklist('${esc(i.id)}')" />
              <span style="${c.checklist?.[i.id] ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(i.text)}</span>
            </span>
            ${i.custom ? `<button class="btn btn-ghost btn-sm" style="padding:0 8px" onclick="event.preventDefault();removeChecklistItem('${esc(i.id)}')">✕</button>` : ''}
          </label>`).join('')}
      </div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="text" id="cl-new" placeholder="Acrescentar documento…" style="flex:1;min-width:200px" onkeydown="if(event.key==='Enter')addChecklistItem()" />
          <button class="btn btn-secondary btn-sm" onclick="addChecklistItem()">Adicionar</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" onclick="copyPending()">Copiar pendências</button>
        <button class="btn btn-teal btn-sm" onclick="sendPendingWhatsApp()">Pedir pendências por WhatsApp</button>
      </div>
    </div>`
}

function refreshChecklist() {
  const c = state.selectedCase
  if (!c) return
  set('case-tab-content', renderChecklistTab(c))
  const items = checklistItems(c)
  const pct = items.length ? Math.round((items.filter(i => c.checklist?.[i.id]).length / items.length) * 100) : 0
  const num = el('case-pct'); if (num) num.textContent = pct + '%'
  const bar = el('case-pct-bar'); if (bar) bar.innerHTML = progressBar(pct, 'var(--accent-blue)', 6)
}

function commitChecklist(patch) {
  const c = state.selectedCase
  const merged = { ...c, ...patch }
  const items = checklistItems(merged)
  const pct = items.length ? Math.round((items.filter(i => merged.checklist?.[i.id]).length / items.length) * 100) : 0
  saveCaseFields(c.id, { ...patch, completionPct: pct })
  refreshChecklist()
}

window.toggleChecklist = function (id) {
  const c = state.selectedCase; if (!c) return
  const cl = { ...(c.checklist || {}) }
  if (cl[id]) delete cl[id]; else cl[id] = true
  commitChecklist({ checklist: cl })
}

window.addChecklistItem = function () {
  const c = state.selectedCase
  const text = el('cl-new')?.value.trim()
  if (!c || !text) return
  commitChecklist({ checklistCustom: [...(c.checklistCustom || []), { id: uid('ck'), text }] })
}

window.removeChecklistItem = function (id) {
  const c = state.selectedCase; if (!c) return
  const cl = { ...(c.checklist || {}) }; delete cl[id]
  commitChecklist({ checklistCustom: (c.checklistCustom || []).filter(x => x.id !== id), checklist: cl })
}

function pendingText(c) {
  const pend = checklistItems(c).filter(i => !c.checklist?.[i.id]).map(i => `• ${i.text}`)
  if (!pend.length) return ''
  const first = (c.clientName || '').trim().split(/\s+/)[0]
  return `Olá${first ? ', ' + first : ''}! Para seguirmos com o seu processo, ainda precisamos dos seguintes documentos:\n\n${pend.join('\n')}\n\nSe algum você não tiver, me avise que a gente vê como resolver.`
}

window.copyPending = async function () {
  const t = pendingText(state.selectedCase)
  if (!t) { alert('Todos os documentos já foram reunidos.'); return }
  if (await copyText(t)) alert('Lista de pendências copiada.')
}

window.sendPendingWhatsApp = function () {
  const c = state.selectedCase
  const t = pendingText(c)
  if (!t) { alert('Todos os documentos já foram reunidos.'); return }
  window.open(whatsappUrl(c.clientPhone, t), '_blank')
}

// ─── INIT ─────────────────────────────────────────────────────────

;(function init() {
  initFirebase()

  // Se Firebase configurado, ouve estado de auth
  if (state.fbAuth) {
    onAuthStateChanged(state.fbAuth, user => {
      if (user && !state.currentUser) {
        const cfg = loadConfig()
        state.currentUser = {
          id: user.uid,
          name: user.displayName || cfg.userName || user.email.split('@')[0],
          email: user.email,
          role: 'admin',
          firm: cfg.firmName || 'Lexis AI',
          avatar: (user.displayName || user.email || 'U')[0].toUpperCase(),
          plan: 'Enterprise'
        }
        showApp()
      }
    })
  }

  // Enter no login
  document.getElementById('login-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin()
  })
  document.getElementById('login-email')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') el('login-password')?.focus()
  })
})()