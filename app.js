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
function getGroqKey() {
  return "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"
}

function getGroqModel() {
  return "llama-3.3-70b-versatile"
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
    // Aguarda carregamento em progresso
    return new Promise(resolve => {
      const check = setInterval(() => {
        if (state.ffmpegReady) { clearInterval(check); resolve(_ffmpeg) }
      }, 200)
    })
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
    // Expõe fetchFile globalmente para uso interno
    _ffmpeg._fetchFile = fetchFile
    state.ffmpegReady = true
    state.ffmpegLoading = false
    console.log('[FFmpeg] Carregado com sucesso')
    return _ffmpeg
  } catch (e) {
    state.ffmpegLoading = false
    console.error('[FFmpeg] Falha ao carregar:', e)
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
  try {
    onProgress?.({ stage: 'Carregando FFmpeg…', pct: 5 })
    const ffmpeg = await loadFFmpeg()
    if (!ffmpeg) throw new Error('FFmpeg indisponível')

    const ext = blob.type.includes('webm') ? 'webm' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : 'webm'
    const inputName = 'input.' + ext
    const outputName = 'audio.mp3'

    onProgress?.({ stage: 'Lendo arquivo…', pct: 15 })
    ffmpeg.writeFile(inputName, await ffmpeg._fetchFile(blob))

    onProgress?.({ stage: 'Extraindo áudio…', pct: 35 })
    await ffmpeg.exec([
      '-i', inputName,
      '-vn',              // sem vídeo
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-y', outputName
    ])

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
function navigate(page, elem) {
  if (elem) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
    elem.classList.add('active')
  }
  state.currentPage = page
  renderPage(page)
  updateHeader(page)
}
window.navigate = navigate

// ─── GROQ AI ─────────────────────────────────────────────────────

async function groqChat(messages, systemPrompt = '', opts = {}) {
  const apiKey = opts.apiKey || getGroqKey()
  const model = opts.model || getGroqModel()
  if (!apiKey) throw new Error('Chave Groq não configurada. Configure em Configurações → Groq AI.')
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, temperature: opts.temperature ?? 0.7, max_tokens: opts.max_tokens ?? 2048,
      messages: [...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []), ...messages],
    }),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `Groq API erro ${res.status}`) }
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || ''
}

async function generateScript(witnessData) {
  const { witness, witnessRole, focus = [], caseContext = '' } = witnessData
  const roleLabel = witnessRole === 'defense' ? 'defesa' : witnessRole === 'prosecution' ? 'acusação' : 'neutra'
  const focusLabels = { contradictions: 'contradições e inconsistências', facts: 'fatos e cronologia', credibility: 'credibilidade da testemunha', documents: 'documentos e provas materiais' }
  const focusStr = focus.map(f => focusLabels[f] || f).join(', ') || 'fatos gerais'
  const systemPrompt = `Você é um assistente jurídico especializado em processo civil e penal brasileiro. Gere roteiros de oitiva estruturados, objetivos e estratégicos. Sempre responda em JSON válido, sem markdown, sem texto fora do JSON.`
  const userPrompt = `Gere um roteiro de oitiva para a testemunha "${witness}" (${roleLabel}). Foco principal: ${focusStr}. ${caseContext ? `Contexto: ${caseContext}` : ''}\n\nRetorne SOMENTE este JSON:\n{"witness":"${witness}","createdAt":"${new Date().toISOString().slice(0,10)}","status":"ready","questions":[{"id":1,"category":"Identificação|Fatos|Contradição|Contexto|Documentos","text":"pergunta aqui","aiFlag":false,"priority":"normal|high|critical"}]}\n\nGere entre 8 e 12 perguntas. Marque aiFlag:true nas contradições. Prioridade critical para contradições, high para fatos centrais, normal para contexto.`
  const raw = await groqChat([{ role: 'user', content: userPrompt }], systemPrompt, { temperature: 0.5 })
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()) }
  catch { return { witness, createdAt: new Date().toISOString().slice(0,10), status: 'ready', questions: [{ id: 1, category: 'Identificação', text: 'Qual é a sua relação com as partes do processo?', aiFlag: false, priority: 'normal' }, { id: 2, category: 'Fatos', text: 'Descreva o que presenciou na data dos fatos.', aiFlag: false, priority: 'high' }, { id: 3, category: 'Contradição', text: 'Seu depoimento anterior difere em algum ponto do que relatou agora. Como explica?', aiFlag: true, priority: 'critical' }] } }
}

async function generateReport(type, caseData) {
  const typeLabels = { probatorio: 'Relatório Probatório', audiencia: 'Memorando de Audiência', contradicoes: 'Relatório de Contradições', resumo: 'Resumo Executivo do Caso' }
  const label = typeLabels[type] || 'Relatório Jurídico'
  const systemPrompt = `Você é um redator jurídico especializado em direito brasileiro. Escreva relatórios formais, objetivos e bem estruturados. Use linguagem técnica-jurídica adequada.`
  const userPrompt = `Elabore um "${label}" para o caso:\nTítulo: ${caseData.title || 'N/A'}\nNúmero: ${caseData.number || 'N/A'}\nCliente: ${caseData.clientName || 'N/A'}\nTribunal: ${caseData.court || 'N/A'}\nValor: ${caseData.value || 'N/A'}\nStatus: ${caseData.status || 'ativo'}\nRisco: ${caseData.riskLevel || 'não avaliado'}\nTags: ${(caseData.tags || []).join(', ')}\n\nEscreva o relatório completo com seções marcadas por "## Título da Seção". Inclua: introdução, análise dos fatos, análise probatória, conclusão e recomendações.`
  const content = await groqChat([{ role: 'user', content: userPrompt }], systemPrompt, { temperature: 0.4, max_tokens: 3000 })
  return { label, content, generatedAt: new Date().toISOString(), caseId: caseData.id }
}

async function chatWithAI(message, history = [], caseContext = null) {
  const systemPrompt = `Você é a Lexis, assistente jurídica inteligente especializada em direito brasileiro. Ajuda advogados com análise de casos, estratégia processual, roteiros de oitiva e relatórios. Seja concisa, precisa e use linguagem técnica adequada ao contexto jurídico.${caseContext ? `\n\nContexto do caso atual:\n${JSON.stringify(caseContext, null, 2)}` : ''}\nNão invente jurisprudência ou normas. Se não souber, diga claramente.`
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

  const systemPrompt = `Você é um assistente jurídico especializado em direito brasileiro. Analise documentos jurídicos de forma objetiva. Responda SOMENTE em JSON válido, sem markdown, sem texto fora do JSON.`
  const userPrompt = `Analise o texto extraído deste documento jurídico e retorne SOMENTE este JSON:\n{"summary":"resumo em 2-3 frases","keyPoints":["ponto 1","ponto 2","ponto 3"],"risks":["risco identificado"],"contradictions":["contradição ou inconsistência (se houver)"],"recommendations":["recomendação jurídica 1","recomendação 2"],"riskLevel":"low|medium|high","documentType":"tipo do documento"}\n\nTexto do documento:\n${pdfText}`

  const raw = await groqChat([{ role: 'user', content: userPrompt }], systemPrompt, { temperature: 0.3, max_tokens: 1500 })
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()) }
  catch { return { summary: raw, keyPoints: [], risks: [], contradictions: [], recommendations: [], riskLevel: 'medium', documentType: 'Documento' } }
}

/**
 * Transcreve áudio via Groq Whisper e analisa juridicamente via Groq Llama.
 */
async function analyzeAudioWithGroq(blob, caseContext = '') {
  const key = getGroqKey()
  if (!key) throw new Error('Chave Groq não configurada. Configure em Configurações → Groq AI.')

  // 1. Tenta extrair MP3 com FFmpeg; se falhar usa blob original
  let audioBlob = blob
  try { audioBlob = await extractAudioMp3(blob, () => {}) } catch {}

  // 2. Transcreve com Groq Whisper
  const formData = new FormData()
  const ext = audioBlob.type.includes('mp3') ? 'mp3' : audioBlob.type.includes('mp4') ? 'mp4' : audioBlob.type.includes('ogg') ? 'ogg' : 'webm'
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
    const snap = await getDocs(query(collection(state.fbDb, 'cases', caseId, 'recordings'), orderBy('createdAt', 'desc')))
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
 * Upload de gravação de depoimento para Firebase Storage.
 * Usa FFmpeg para converter WebM → MP4 antes do envio.
 * Salva metadados em cases/{caseId}/recordings.
 */
async function uploadRecordingToFirebase(caseId, blob, meta, onProgress) {
  // 1. Converte com FFmpeg (WebM → MP4)
  let uploadBlob = blob
  const isAudioOnly = !blob.type.includes('video')

  if (isAudioOnly) {
    // Áudio puro: extrai MP3
    uploadBlob = await extractAudioMp3(blob, p => onProgress?.({ ...p, pct: Math.min(p.pct, 50) }))
  } else {
    // Vídeo: converte para MP4
    uploadBlob = await convertToMp4(blob, p => onProgress?.({ ...p, pct: Math.min(p.pct, 50) }))
  }

  if (!state.fbStorage) throw new Error('Firebase Storage não configurado.')

  const ext = isAudioOnly ? 'mp3' : 'mp4'
  const filename = `dep_${Date.now()}.${ext}`
  const path = `cases/${caseId}/recordings/${filename}`
  const fileRef = storageRef(state.fbStorage, path)
  const task = uploadBytesResumable(fileRef, uploadBlob)

  return new Promise((resolve, reject) => {
    task.on('state_changed',
      snap => {
        const pct = 50 + Math.round(snap.bytesTransferred / snap.totalBytes * 50)
        onProgress?.({ stage: 'Enviando para o Firebase…', pct })
      },
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref)
        const recData = {
          ...meta,
          url,
          storagePath: path,
          format: ext,
          createdAt: serverTimestamp(),
          status: 'uploaded',
          size: `${(uploadBlob.size / 1048576).toFixed(1)} MB`,
        }
        if (state.fbDb) {
          await addDoc(collection(state.fbDb, 'cases', caseId, 'recordings'), recData)
        }
        resolve({ ...recData, createdAt: new Date().toISOString() })
      }
    )
  })
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
  navigate('dashboard', document.querySelector('.nav-item[data-page="dashboard"]'))
  // Pré-carrega FFmpeg em segundo plano
  loadFFmpeg().catch(() => {})
}

// ─── HEADER ───────────────────────────────────────────────────────

const pageTitles = {
  dashboard: ['Dashboard', 'Visão geral do escritório'],
  cases: ['Casos', 'Gestão processual'],
  'case-detail': () => [state.selectedCase?.title || 'Detalhe do Caso', state.selectedCase?.number || ''],
  script: () => ['Roteiro de Oitiva', state.selectedCase ? `${state.selectedCase.title}` : 'Selecione um caso'],
  video: () => ['Depoimentos', state.selectedCase ? state.selectedCase.title : 'Selecione um caso'],
  reports: () => ['Relatórios', state.selectedCase ? state.selectedCase.title : 'Selecione um caso'],
  'new-case': ['Novo Caso', 'Cadastro multi-etapas'],
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
    case 'script': renderScript(); break
    case 'video': renderVideo(); break
    case 'reports': renderReports(); break
    case 'new-case': renderNewCase(); break
    case 'settings': renderSettings(); break
    default: renderDashboard()
  }
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
  // Include locally-created demo cases
  if (!state.fbReady) {
    cases = state.cases.filter(c => c.id?.startsWith('local-'))
  } else {
    state.cases = cases
  }

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
      ${metricCard('Casos Ativos', active, 'Em andamento', 'var(--accent-blue)')}
      ${metricCard('Pendentes', pending, 'Aguardando ação', 'var(--risk-med)')}
      ${metricCard('Encerrados', closed, 'Total concluídos', 'var(--risk-low)')}
      ${metricCard('Alto Risco', highRisk, 'Requer atenção', 'var(--risk-high)')}
    </div>

    <div class="card" style="overflow:hidden">
      <div style="padding:18px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <span class="section-title">Casos Recentes</span>
        <button class="btn btn-ghost btn-sm" onclick="navigate('cases',document.querySelector('.nav-item[data-page=cases]'))">Ver todos →</button>
      </div>
      ${cases.length === 0
        ? `<div class="empty-state"><div class="empty-icon">📁</div><div class="empty-title">Nenhum caso cadastrado</div><div class="empty-desc">Crie seu primeiro caso para começar.</div><div style="margin-top:16px"><button class="btn btn-primary btn-sm" onclick="navigate('new-case',null)">Criar Caso</button></div></div>`
        : `<table>
            <thead><tr><th>Caso</th><th>Status</th><th>Risco</th><th>Progresso</th><th>Próx. Audiência</th></tr></thead>
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
      <input type="text" id="cases-search" placeholder="Buscar por título, cliente ou número…" style="max-width:320px" oninput="filterCases()" />
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
    const cases = await getCases()
    state.cases = cases
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
              ${[['Cliente', c.clientName], ['Tribunal', c.court], ['Valor', c.value]].filter(f => f[1]).map(f => `
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
  state.selectedCase = state.cases.find(c => c.id === id)
  if (!state.selectedCase) return
  navigate('case-detail', document.querySelector('.nav-item[data-page="case-detail"]'))
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
            ${[['Cliente', c.clientName], ['Tribunal', c.court], ['Juiz(a)', c.judge], ['Valor', c.value], ['Próx. Audiência', c.nextHearing ? fmt.date(c.nextHearing) : '—']].filter(f => f[1]).map(f => `
              <div><div class="case-meta-label">${f[0]}</div><div class="case-meta-value">${f[1]}</div></div>
            `).join('')}
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Progresso geral</div>
          <div style="font-size:32px;font-weight:700;color:var(--accent-blue);letter-spacing:-0.03em">${c.completionPct || 0}%</div>
          <div style="width:120px;margin-top:8px">${progressBar(c.completionPct || 0, 'var(--accent-blue)', 6)}</div>
        </div>
      </div>
    </div>

    <div class="page-actions">
      <button class="btn btn-primary btn-sm" onclick="navigate('script',document.querySelector('.nav-item[data-page=script]'))">Roteiro de Oitiva</button>
      <button class="btn btn-secondary btn-sm" onclick="navigate('video',document.querySelector('.nav-item[data-page=video]'))">Depoimentos</button>
      <button class="btn btn-secondary btn-sm" onclick="navigate('reports',document.querySelector('.nav-item[data-page=reports]'))">Relatórios</button>
      <button class="btn btn-gold btn-sm" onclick="exportCaseTxt()">Exportar TXT</button>
      <button class="btn btn-secondary btn-sm" onclick="openEditCase()">Editar Caso</button>
    </div>

    <div class="tabs">
      <button class="tab-btn active" onclick="switchCaseTab(this,'overview')">Visão Geral</button>
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
  } else if (tab === 'documents') {
    set('case-tab-content', `<div style="text-align:center;padding:32px">${spinner('spinner-lg')}</div>`)
    const docs = await getDocumentsForCase(c.id)
    set('case-tab-content', renderDocsTab(c, docs))
  } else if (tab === 'ai') {
    set('case-tab-content', `
      <div class="card" style="padding:24px">
        <div style="font-size:14px;font-weight:600;margin-bottom:16px">Sugestões da IA para este caso</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${[['Gerar roteiro de oitiva', 'A IA analisa o caso e cria perguntas estratégicas personalizadas.', 'script'],
             ['Relatório probatório', 'Análise completa de provas, contradições e pontuação de risco.', 'reports'],
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
      <div class="card" style="width:520px;padding:28px;max-height:80vh;overflow-y:auto" onclick="event.stopPropagation()">
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
    notes: el('edit-notes').value,
  }
  if (!data.title) { alert('Título obrigatório.'); return }
  try {
    await updateCase(state.selectedCase.id, data)
    state.selectedCase = { ...state.selectedCase, ...data }
    closeEditCase()
    renderCaseDetail()
  } catch (e) { alert('Erro: ' + e.message) }
}

window.exportCaseTxt = function() {
  const c = state.selectedCase; if (!c) return
  const content = `LEXIS AI — EXPORTAÇÃO DO CASO\n${'='.repeat(40)}\n\nCASO: ${c.title}\nNÚMERO: ${c.number || '—'}\nCLIENTE: ${c.clientName || '—'}\nTRIBUNAL: ${c.court || '—'}\nJUIZ(A): ${c.judge || '—'}\nSTATUS: ${fmt.status(c.status)}\nRISCO: ${fmt.risk(c.riskLevel)}\nVALOR: ${c.value || '—'}\nPRÓXIMA AUDIÊNCIA: ${c.nextHearing ? fmt.date(c.nextHearing) : '—'}\nPROGRESSO: ${c.completionPct || 0}%\n\nGerado por Lexis AI em ${new Date().toLocaleDateString('pt-BR')}`
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' })); a.download = `${c.title.replace(/\s+/g,'_')}_resumo.txt`; a.click()
}

// ─── SCRIPT PAGE — INSTRUÇÃO CONCENTRADA ─────────────────────────
// Fluxo: 1) Linha do Tempo de vínculos → 2) Configurar Roteiro → 3) Modo Oitiva

// Estado da linha do tempo e do roteiro
if (!state.timeline) state.timeline = [] // [{id, empresa, cargo, inicio, fim, regime, obs}]
if (!state.scriptTab) state.scriptTab = 'timeline' // 'timeline' | 'form' | 'hearing'
if (!state.activeQuestionIdx) state.activeQuestionIdx = 0

function renderScript() {
  const c = state.selectedCase
  const tab = state.scriptTab || 'timeline'
  const hasScript = !!state.scriptData
  const hasTimeline = state.timeline.length > 0

  set('main-content', `
    ${!c ? `<div class="alert-warn" style="margin-bottom:16px">⚠ Nenhum caso selecionado. Selecione um caso para gerar roteiros estratégicos.</div>` : ''}

    <div class="ic-tabs-bar">
      <button class="ic-tab ${tab==='timeline'?'active':''}" onclick="switchScriptTab('timeline')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><line x1="3" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="1.5"/><line x1="15" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="1.5"/></svg>
        Linha do Tempo
        ${hasTimeline ? `<span class="ic-tab-badge">${state.timeline.length}</span>` : ''}
      </button>
      <button class="ic-tab ${tab==='form'?'active':''}" onclick="switchScriptTab('form')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="1.5"/></svg>
        Configurar Roteiro
      </button>
      <button class="ic-tab ${tab==='hearing'?'active':''}" onclick="switchScriptTab('hearing')" ${!hasScript?'disabled title="Gere o roteiro primeiro"':''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" stroke-width="1.5"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Modo Oitiva
        ${hasScript ? '<span class="ic-tab-badge ic-tab-badge-green">●</span>' : ''}
      </button>
    </div>

    <div id="script-tab-content" class="fade-in">
      ${tab==='timeline' ? renderTimelineTab() : tab==='form' ? renderScriptFormTab() : renderHearingTab()}
    </div>
  `)
  initTimelineListeners()
}

window.switchScriptTab = function(tab) {
  state.scriptTab = tab
  renderScript()
}

// ── TAB 1: LINHA DO TEMPO ─────────────────────────────────────────

function renderTimelineTab() {
  const periods = state.timeline
  return `
    <div style="max-width:820px">
      <div style="margin-bottom:20px">
        <div style="font-size:15px;font-weight:600;margin-bottom:4px">Linha do Tempo de Vínculos</div>
        <div style="font-size:13px;color:var(--text-muted)">Cadastre os períodos de trabalho do reclamante. O roteiro de oitiva será gerado levando em conta esses vínculos.</div>
      </div>

      <!-- Formulário de novo vínculo -->
      <div class="card" style="padding:20px;margin-bottom:20px;border:1px solid var(--accent-blue-border)">
        <div style="font-size:13px;font-weight:600;margin-bottom:14px;color:var(--accent-blue)">+ Adicionar Vínculo</div>
        <div class="grid-2" style="gap:12px;margin-bottom:12px">
          <div class="field"><label>Empresa / Empregador *</label><input type="text" id="tl-empresa" placeholder="Ex.: Empresa XYZ Ltda." /></div>
          <div class="field"><label>Cargo / Função *</label><input type="text" id="tl-cargo" placeholder="Ex.: Motorista" /></div>
        </div>
        <div class="grid-2" style="gap:12px;margin-bottom:12px">
          <div class="field"><label>Início *</label><input type="month" id="tl-inicio" style="background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-md);border-radius:var(--radius-sm);padding:8px 12px;font-family:inherit;width:100%" /></div>
          <div class="field"><label>Fim (vazio = atual)</label><input type="month" id="tl-fim" style="background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-md);border-radius:var(--radius-sm);padding:8px 12px;font-family:inherit;width:100%" /></div>
        </div>
        <div class="grid-2" style="gap:12px;margin-bottom:14px">
          <div class="field"><label>Regime de Trabalho</label>
            <select id="tl-regime">
              <option value="clt">CLT</option>
              <option value="pj">PJ / Autônomo</option>
              <option value="intermitente">Intermitente</option>
              <option value="temporario">Temporário</option>
              <option value="cooperado">Cooperado</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div class="field"><label>Observação (opcional)</label><input type="text" id="tl-obs" placeholder="Ex.: CTPS anotada, reconhecimento forçado…" /></div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="addTimelinePeriod()">Adicionar à Linha do Tempo</button>
      </div>

      <!-- Visualização da linha do tempo -->
      ${periods.length === 0 ? `
        <div class="empty-state card" style="padding:40px">
          <div class="empty-icon">📅</div>
          <div class="empty-title">Nenhum vínculo cadastrado ainda</div>
          <div class="empty-desc">Adicione os períodos de trabalho do reclamante acima.</div>
        </div>
      ` : `
        <div style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
          <span class="section-muted">${periods.length} vínculo${periods.length>1?'s':''} cadastrado${periods.length>1?'s':''}</span>
          <button class="btn btn-ghost btn-sm" onclick="clearTimeline()">Limpar tudo</button>
        </div>
        <div class="tl-visual">
          ${periods.map((p,i) => renderTimelineCard(p,i)).join('')}
        </div>
      `}

      <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="switchScriptTab('form')">
          Configurar Roteiro →
        </button>
        ${periods.length > 0 ? `<span style="font-size:12px;color:var(--text-muted);align-self:center">✓ ${periods.length} vínculo${periods.length>1?'s':''} vão influenciar o roteiro</span>` : ''}
      </div>
    </div>`
}

function renderTimelineCard(p, i) {
  const regimeColor = { clt:'var(--accent-blue)', pj:'var(--accent-gold)', intermitente:'var(--accent-teal)', temporario:'var(--risk-med)', cooperado:'var(--risk-low)', outro:'var(--text-muted)' }
  const color = regimeColor[p.regime] || 'var(--text-muted)'
  const duracao = calcDuracao(p.inicio, p.fim)
  return `
    <div class="tl-card fade-up" style="animation-delay:${i*0.05}s;border-left-color:${color}">
      <div class="tl-card-line" style="background:${color}"></div>
      <div class="tl-card-dot" style="background:${color}"></div>
      <div class="tl-card-body">
        <div class="tl-card-header">
          <div>
            <div style="font-size:14px;font-weight:600">${p.empresa}</div>
            <div style="font-size:12px;color:var(--text-secondary)">${p.cargo}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <span class="badge" style="background:${color}18;color:${color};border:1px solid ${color}44">${p.regime.toUpperCase()}</span>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${duracao}</div>
          </div>
        </div>
        <div class="tl-card-dates">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          ${fmtMonth(p.inicio)} → ${p.fim ? fmtMonth(p.fim) : '<span style="color:var(--risk-low)">Atual</span>'}
          ${p.obs ? `<span style="margin-left:10px;color:var(--text-muted)">· ${p.obs}</span>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-top:8px;color:var(--risk-high)" onclick="removeTimelinePeriod(${i})">Remover</button>
      </div>
    </div>`
}

function fmtMonth(ym) {
  if (!ym) return '—'
  const [y, m] = ym.split('-')
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${months[parseInt(m)-1]}/${y}`
}

function calcDuracao(inicio, fim) {
  if (!inicio) return ''
  const start = new Date(inicio + '-01')
  const end = fim ? new Date(fim + '-01') : new Date()
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (months < 12) return `${months} mes${months>1?'es':''}`
  const years = Math.floor(months / 12), rem = months % 12
  return `${years} ano${years>1?'s':''}${rem > 0 ? ` e ${rem} mes${rem>1?'es':''}` : ''}`
}

window.addTimelinePeriod = function() {
  const empresa = el('tl-empresa')?.value.trim()
  const cargo = el('tl-cargo')?.value.trim()
  const inicio = el('tl-inicio')?.value
  if (!empresa || !cargo || !inicio) { alert('Preencha empresa, cargo e data de início.'); return }
  const period = {
    id: 'tl-' + Date.now(),
    empresa, cargo, inicio,
    fim: el('tl-fim')?.value || null,
    regime: el('tl-regime')?.value || 'clt',
    obs: el('tl-obs')?.value.trim() || '',
  }
  state.timeline.push(period)
  state.timeline.sort((a,b) => a.inicio.localeCompare(b.inicio))
  renderScript()
}

window.removeTimelinePeriod = function(idx) {
  state.timeline.splice(idx, 1)
  renderScript()
}

window.clearTimeline = function() {
  if (!confirm('Remover todos os vínculos?')) return
  state.timeline = []
  renderScript()
}

function initTimelineListeners() {
  // nothing needed — onclick inline
}

// ── TAB 2: CONFIGURAR ROTEIRO ─────────────────────────────────────

function renderScriptFormTab() {
  const c = state.selectedCase
  const hasTimeline = state.timeline.length > 0
  const tlSummary = hasTimeline
    ? state.timeline.map(p => `${p.empresa} (${p.cargo}, ${fmtMonth(p.inicio)}–${p.fim?fmtMonth(p.fim):'atual'}, ${p.regime.toUpperCase()}${p.obs?' — '+p.obs:''})`).join('; ')
    : ''

  return `
    <div class="grid-auto" style="align-items:start">
      <div>
        ${hasTimeline ? `
          <div class="alert-info" style="margin-bottom:16px;display:flex;align-items:flex-start;gap:10px">
            <span style="font-size:16px;flex-shrink:0">📅</span>
            <div>
              <div style="font-weight:600;margin-bottom:4px">Linha do tempo ativa</div>
              <div style="font-size:12px;color:var(--text-secondary);line-height:1.5">${state.timeline.length} vínculo${state.timeline.length>1?'s':''} influenciarão o roteiro automaticamente.</div>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="switchScriptTab('timeline')" style="margin-left:auto;flex-shrink:0">Editar</button>
          </div>` : `
          <div class="alert-warn" style="margin-bottom:16px">
            ⚠ Nenhum vínculo cadastrado. <button class="btn btn-ghost btn-sm" onclick="switchScriptTab('timeline')" style="padding:2px 8px">Adicionar →</button>
          </div>`}

        <div class="card" style="padding:22px;margin-bottom:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:18px">Configurar Roteiro Estratégico</div>
          <div style="display:flex;flex-direction:column;gap:14px">
            <div class="field">
              <label>Nome da Testemunha / Reclamante *</label>
              <input type="text" id="script-witness" placeholder="Ex.: João da Silva" />
            </div>
            <div class="grid-2" style="gap:12px">
              <div class="field">
                <label>Papel na Ação</label>
                <select id="script-role">
                  <option value="reclamante">Reclamante</option>
                  <option value="preposto">Preposto da empresa</option>
                  <option value="testemunha-autora">Testemunha da Autora</option>
                  <option value="testemunha-ré">Testemunha da Ré</option>
                  <option value="perito">Perito</option>
                </select>
              </div>
              <div class="field">
                <label>Tipo de Ação</label>
                <select id="script-action-type">
                  <option value="reclamatoria">Reclamatória Trabalhista</option>
                  <option value="acidente">Acidente de Trabalho</option>
                  <option value="assedio">Assédio / Danos Morais</option>
                  <option value="horas-extras">Horas Extras</option>
                  <option value="rescisao">Rescisão Indireta</option>
                  <option value="reconhecimento">Reconhecimento de Vínculo</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label>Temas prioritários</label>
              <div class="ic-checkgroup">
                ${[
                  ['vinculo','Comprovação / negação do vínculo'],
                  ['jornada','Jornada e horas extras'],
                  ['condicoes','Condições e ambiente de trabalho'],
                  ['verbas','Verbas rescisórias'],
                  ['subordinacao','Subordinação e dependência econômica'],
                  ['contradictions','Contradições e inconsistências'],
                  ['documentos','Documentos e provas materiais'],
                  ['testemunho','Credibilidade do testemunho'],
                ].map(([val,lbl]) => `
                  <label class="ic-check-item">
                    <input type="checkbox" id="focus-${val}" ${['vinculo','jornada','contradictions'].includes(val)?'checked':''} />
                    <span>${lbl}</span>
                  </label>`).join('')}
              </div>
            </div>
            <div class="field">
              <label>Contexto adicional do caso (opcional)</label>
              <textarea id="script-context" placeholder="Inclua fatos específicos, documentos relevantes, divergências já conhecidas…" style="min-height:80px"></textarea>
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
            <div class="section-muted" style="margin-bottom:12px">Vínculos Cadastrados</div>
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
              'Use datas precisas dos vínculos para pressionar inconsistências.',
              'Explore regime de trabalho: PJ ou cooperado podem mascarar vínculo CLT.',
              'Confirme se houve CTPS anotada, holerites ou recibos.',
              'Perguntas sobre rotina diária revelam subordinação.',
              'Reserve contradições para o final — não antecipe.',
              'Silêncio estratégico após respostas importantes produz mais.',
            ].map(t => `<div style="display:flex;gap:8px"><span style="color:var(--accent-teal);flex-shrink:0">→</span>${t}</div>`).join('')}
          </div>
        </div>
      </div>
    </div>`
}

window.handleGenerateScript = async function() {
  const witness = el('script-witness')?.value?.trim()
  if (!witness) { alert('Informe o nome da testemunha/reclamante.'); return }
  const focus = ['vinculo','jornada','condicoes','verbas','subordinacao','contradictions','documentos','testemunho'].filter(f => el('focus-'+f)?.checked)
  const role = el('script-role')?.value || 'reclamante'
  const actionType = el('script-action-type')?.value || 'reclamatoria'
  const context = el('script-context')?.value || ''
  const c = state.selectedCase

  const timelineCtx = state.timeline.length > 0
    ? `\n\nLINHA DO TEMPO DE VÍNCULOS:\n${state.timeline.map(p => `- ${p.empresa} | ${p.cargo} | ${fmtMonth(p.inicio)}–${p.fim?fmtMonth(p.fim):'atual'} | ${p.regime.toUpperCase()}${p.obs?' | Obs: '+p.obs:''}`).join('\n')}`
    : ''

  const btn = el('script-gen-btn')
  btn.disabled = true; btn.innerHTML = `${spinner()} Gerando roteiro estratégico…`
  set('script-output', `<div style="text-align:center;padding:48px">${spinner('spinner-lg')}<div style="font-size:13px;color:var(--text-muted);margin-top:16px">IA analisando vínculos e montando roteiro…</div></div>`)

  try {
    const caseCtx = c ? `Caso: ${c.title}. Cliente: ${c.clientName || ''}. Tribunal: ${c.court || ''}. ` : ''
    const script = await generateScript({
      witness, witnessRole: role, focus, actionType,
      caseContext: caseCtx + context + timelineCtx,
      timeline: state.timeline,
    })
    state.scriptData = script
    state.activeQuestionIdx = 0
    if (c && state.fbDb) {
      try { await addDoc(collection(state.fbDb, 'cases', c.id, 'scripts'), { ...script, createdAt: serverTimestamp() }) } catch {}
    }
    renderScriptResult(script)
  } catch (e) {
    set('script-output', `<div class="alert-error">${e.message}</div>`)
  }
  btn.disabled = false; btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2a2 2 0 0 1 2 2v.5a.5.5 0 0 0 .5.5H16a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-1.5a.5.5 0 0 0-.5.5V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="15" r="3" stroke="currentColor" stroke-width="1.5"/></svg>Gerar Roteiro Estratégico com IA`
}

function renderScriptResult(script) {
  const c = state.selectedCase
  const prioColor = { critical:'var(--risk-high)', high:'var(--risk-med)', normal:'var(--text-muted)' }
  const prioLabel = { critical:'Crítico', high:'Alta prioridade', normal:'Normal' }
  set('script-output', `
    <div class="fade-up">
      <div class="card" style="padding:16px 20px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:14px;font-weight:600">${script.witness}</div>
          <div style="font-size:12px;color:var(--text-muted)">${script.questions.length} perguntas estratégicas · ${c?.title || '—'}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="switchScriptTab('hearing')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" stroke-width="1.5"/></svg>
            Iniciar Oitiva
          </button>
          <button class="btn btn-ghost btn-sm" onclick="exportScript()">Exportar TXT</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${script.questions.map((q, i) => `
          <div class="card question-card priority-${q.priority} fade-up" style="animation-delay:${i*0.04}s">
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div class="question-num">${i+1}</div>
              <div style="flex:1">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
                  <span class="badge badge-neutral">${q.category}</span>
                  ${q.aiFlag ? '<span class="badge badge-risk-high">⚠ Contradição</span>' : ''}
                  <span style="margin-left:auto;font-size:11px;color:${prioColor[q.priority]}">${prioLabel[q.priority]}</span>
                </div>
                <p style="font-size:13px;line-height:1.6;margin:0">${q.text}</p>
                ${q.rationale ? `<p style="font-size:11px;color:var(--text-muted);margin:6px 0 0;font-style:italic">${q.rationale}</p>` : ''}
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>`)
}

window.exportScript = function() {
  if (!state.scriptData) return
  const tl = state.timeline.length > 0
    ? ['\nLINHA DO TEMPO:', ...state.timeline.map(p => `  • ${p.empresa} | ${p.cargo} | ${fmtMonth(p.inicio)}–${p.fim?fmtMonth(p.fim):'atual'} | ${p.regime.toUpperCase()}`)]
    : []
  const lines = [
    `ROTEIRO DE OITIVA — INSTRUÇÃO CONCENTRADA`,
    `Testemunha: ${state.scriptData.witness}`,
    `Gerado em: ${state.scriptData.createdAt}`,
    `Caso: ${state.selectedCase?.title || '—'}`,
    ...tl, '',
    ...state.scriptData.questions.map((q, i) => `${i+1}. [${q.category}${q.aiFlag?' ⚠':''}] ${q.text}`),
  ]
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }))
  a.download = `roteiro_${state.scriptData.witness.replace(/\s+/g,'_')}.txt`
  a.click()
}

// ── TAB 3: MODO OITIVA ────────────────────────────────────────────

function renderHearingTab() {
  const script = state.scriptData
  if (!script) {
    return `<div class="alert-warn">Gere o roteiro na aba "Configurar Roteiro" primeiro.</div>`
  }
  const q = script.questions
  const idx = Math.max(0, Math.min(state.activeQuestionIdx || 0, q.length - 1))
  const current = q[idx]
  const prioColor = { critical:'var(--risk-high)', high:'var(--risk-med)', normal:'var(--accent-blue)' }
  const pColor = prioColor[current?.priority] || 'var(--accent-blue)'

  return `
    <div class="hearing-layout">

      <!-- Painel Esquerdo: Gravação -->
      <div class="hearing-recorder">
        <div class="card" style="padding:22px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <div id="rec-icon-wrap" style="width:44px;height:44px;border-radius:50%;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;border:1px solid var(--border)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="color:var(--text-muted)"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" stroke-width="1.5"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:600" id="rec-title">Gravação da Oitiva</div>
              <div style="font-size:12px;color:var(--text-muted)">${script.witness} · ${state.selectedCase?.title || 'Sem caso'}</div>
            </div>
            <div style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--risk-high);display:none" id="rec-timer">00:00</div>
          </div>
          <div id="rec-error" class="alert-error" style="display:none"></div>
          <div style="display:flex;gap:10px" id="rec-btns">
            <button class="btn btn-primary" onclick="startRecording()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>
              Gravar
            </button>
            <button class="btn btn-secondary btn-sm" onclick="el('audio-upload-input').click()">Upload</button>
          </div>
          <input type="file" id="audio-upload-input" accept="audio/*,video/*" style="display:none" onchange="handleAudioUpload(event)" />
          <div id="ffmpeg-progress" style="display:none;margin-top:12px">
            <div style="max-width:260px">${progressBar(0,'var(--accent-teal)',6)}</div>
            <div id="ffmpeg-progress-label" style="font-size:12px;color:var(--text-muted);margin-top:6px">Processando…</div>
          </div>
        </div>

        <!-- Anotações da oitiva -->
        <div class="card" style="padding:18px">
          <div style="font-size:13px;font-weight:600;margin-bottom:10px">📝 Anotações</div>
          <textarea id="hearing-notes" placeholder="Anote respostas, reações ou observações importantes durante a oitiva…" style="min-height:120px;font-size:13px;resize:vertical"></textarea>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="exportHearingNotes()">Exportar Anotações</button>
          </div>
        </div>
      </div>

      <!-- Painel Direito: Roteiro -->
      <div class="hearing-script">
        <div class="hearing-script-header">
          <div style="font-size:13px;font-weight:600">${script.witness}</div>
          <div style="font-size:11px;color:var(--text-muted)">${script.questions.length} perguntas</div>
          <div style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="exportScript()" title="Exportar roteiro">⬇</button>
          </div>
        </div>

        <!-- Pergunta atual em destaque -->
        <div class="hearing-current-q" id="hearing-current-q" style="border-color:${pColor}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <span class="question-num" style="background:${pColor}22;color:${pColor}">${idx+1}</span>
            <span class="badge badge-neutral">${current?.category || ''}</span>
            ${current?.aiFlag ? '<span class="badge badge-risk-high">⚠ Contradição</span>' : ''}
            <span style="margin-left:auto;font-size:11px;color:${pColor}">${idx+1} / ${q.length}</span>
          </div>
          <p style="font-size:15px;line-height:1.65;font-weight:500;margin:0">${current?.text || ''}</p>
          ${current?.rationale ? `<p style="font-size:12px;color:var(--text-muted);margin-top:8px;font-style:italic">${current.rationale}</p>` : ''}
          <div style="display:flex;gap:8px;margin-top:16px">
            <button class="btn btn-secondary btn-sm" onclick="prevQuestion()" ${idx===0?'disabled':''}>← Anterior</button>
            <button class="btn btn-primary btn-sm" onclick="nextQuestion()" ${idx===q.length-1?'disabled':''}>Próxima →</button>
            <button class="btn btn-ghost btn-sm" onclick="markQuestionDone(${idx})" title="Marcar como respondida" style="${current?._done?'color:var(--risk-low)':''}">
              ${current?._done ? '✓ Respondida' : 'Marcar ✓'}
            </button>
          </div>
        </div>

        <!-- Lista das outras perguntas -->
        <div class="hearing-q-list" id="hearing-q-list">
          ${q.map((question, i) => `
            <div class="hearing-q-item ${i===idx?'active':''} ${question._done?'done':''}" onclick="goToQuestion(${i})" id="hq-${i}">
              <span class="hq-num" style="${i===idx?`background:${pColor}22;color:${pColor}`:''}">${i+1}</span>
              <span class="hq-text">${question.text}</span>
              ${question._done ? '<span style="color:var(--risk-low);font-size:12px;flex-shrink:0">✓</span>' : ''}
              ${question.aiFlag ? '<span style="color:var(--risk-high);font-size:11px;flex-shrink:0">⚠</span>' : ''}
            </div>`).join('')}
        </div>
      </div>

    </div>`
}

window.prevQuestion = function() {
  if (!state.scriptData) return
  state.activeQuestionIdx = Math.max(0, (state.activeQuestionIdx || 0) - 1)
  refreshHearing()
}

window.nextQuestion = function() {
  if (!state.scriptData) return
  const max = state.scriptData.questions.length - 1
  state.activeQuestionIdx = Math.min(max, (state.activeQuestionIdx || 0) + 1)
  refreshHearing()
}

window.goToQuestion = function(i) {
  state.activeQuestionIdx = i
  refreshHearing()
}

window.markQuestionDone = function(i) {
  if (!state.scriptData) return
  const q = state.scriptData.questions[i]
  q._done = !q._done
  refreshHearing()
}

function refreshHearing() {
  const content = el('script-tab-content')
  if (!content) return
  content.innerHTML = renderHearingTab()
  // Scroll a pergunta ativa para o centro da lista
  setTimeout(() => {
    const item = el('hq-' + state.activeQuestionIdx)
    if (item) item.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, 80)
}

window.exportHearingNotes = function() {
  const notes = el('hearing-notes')?.value || ''
  const c = state.selectedCase
  const script = state.scriptData
  const lines = [
    `ANOTAÇÕES DE OITIVA`,
    `Testemunha: ${script?.witness || '—'}`,
    `Caso: ${c?.title || '—'}`,
    `Data: ${new Date().toLocaleDateString('pt-BR')}`,
    '', notes, '',
    '=== ROTEIRO ===',
    ...(script?.questions.map((q,i) => `${i+1}. ${q.text}${q._done?' [RESPONDIDA]':''}`) || []),
  ]
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], {type:'text/plain'}))
  a.download = `oitiva_${(script?.witness||'sem_nome').replace(/\s+/g,'_')}_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.txt`
  a.click()
}

// ─── VIDEO / DEPOSITIONS ──────────────────────────────────────────

function renderVideo() {
  const c = state.selectedCase
  const noCaseWarn = !c ? `<div class="alert-warn">⚠ Nenhum caso selecionado.</div>` : ''
  set('main-content', `
    ${noCaseWarn}
    <div class="grid-auto" style="align-items:start">
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card" style="padding:24px" id="recorder-card">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
            <div style="width:44px;height:44px;border-radius:50%;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;border:1px solid var(--border)" id="rec-icon-wrap">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="color:var(--text-muted)"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" stroke-width="1.5"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <div>
              <div style="font-size:14px;font-weight:600" id="rec-title">Novo Depoimento</div>
              <div style="font-size:12px;color:var(--text-muted)" id="rec-sub">Iniciar gravação ou fazer upload</div>
            </div>
            <div style="margin-left:auto;font-family:var(--font-mono);font-size:18px;font-weight:600;color:var(--risk-high);display:none" id="rec-timer">00:00</div>
          </div>
          <div id="rec-error" class="alert-error" style="display:none"></div>
          <div id="ffmpeg-status" style="font-size:11px;color:var(--text-muted);margin-bottom:12px;display:none">
            ${spinner()} FFmpeg carregando em segundo plano…
          </div>
          <div style="display:flex;gap:10px" id="rec-btns">
            <button class="btn btn-primary btn-sm" onclick="startRecording()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>
              Iniciar Gravação
            </button>
            <button class="btn btn-secondary btn-sm" onclick="el('audio-upload-input').click()">Upload de Áudio/Vídeo</button>
          </div>
          <input type="file" id="audio-upload-input" accept="audio/*,video/*" style="display:none" onchange="handleAudioUpload(event)" />
          <div id="ffmpeg-progress" style="display:none;margin-top:14px">
            <div style="max-width:300px">${progressBar(0, 'var(--accent-teal)', 6)}</div>
            <div id="ffmpeg-progress-label" style="font-size:12px;color:var(--text-muted);margin-top:6px">Processando…</div>
          </div>
        </div>

        <div class="card" style="overflow:hidden">
          <div style="padding:14px 20px;border-bottom:1px solid var(--border);font-size:13px;font-weight:600">
            Depoimentos${c ? ' — ' + c.title : ''}
            <span id="rec-count" class="badge badge-blue" style="display:none;margin-left:8px">0</span>
          </div>
          <div id="recordings-list">
            <div style="text-align:center;padding:24px">${spinner()}</div>
          </div>
        </div>
      </div>

      <div>
        <div class="card" style="overflow:hidden">
          <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
            <span style="font-size:13px;font-weight:600">Transcrição IA</span>
            <span id="transcript-spinner" style="display:none">${spinner()}</span>
          </div>
          <div id="transcript-content" style="padding:18px">
            <div class="empty-state"><div class="empty-icon">📝</div><div class="empty-desc">Grave um depoimento para ver a transcrição</div></div>
          </div>
          <div id="transcript-actions" style="display:none;padding:12px 18px;border-top:1px solid var(--border)">
            <button class="btn btn-secondary btn-sm" onclick="exportTranscript()">Exportar Transcrição</button>
          </div>
        </div>
      </div>
    </div>
  `)

  loadRecordingsFromFirebase()
}

async function loadRecordingsFromFirebase() {
  const c = state.selectedCase
  if (!c) { renderRecordingsList([]); return }
  try {
    const recs = await getRecordingsForCase(c.id)
    // Mescla com gravações locais da sessão
    const merged = [...state.recordings, ...recs.filter(r => !state.recordings.find(lr => lr.id === r.id))]
    renderRecordingsList(merged)
    const cnt = el('rec-count')
    if (cnt && merged.length > 0) { cnt.textContent = merged.length; cnt.style.display = 'inline-flex' }
  } catch {
    renderRecordingsList(state.recordings)
  }
}

window.startRecording = async function() {
  el('rec-error').style.display = 'none'
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    state.mediaRecorder = new MediaRecorder(stream)
    state.recordingChunks = []
    state.recordingElapsed = 0
    state.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) state.recordingChunks.push(e.data) }
    state.mediaRecorder.onstop = () => {
      const blob = new Blob(state.recordingChunks, { type: 'audio/webm' })
      const c = state.selectedCase
      const meta = {
        name: `Depoimento — ${c?.clientName || 'Sem caso'} — ${new Date().toLocaleDateString('pt-BR')}`,
        date: new Date().toLocaleDateString('pt-BR'),
        duration: formatTime(state.recordingElapsed),
        status: 'transcribed',
        caseId: c?.id,
      }
      const rec = { id: `rec_${Date.now()}`, ...meta, url: URL.createObjectURL(blob), blob }
      state.recordings.unshift(rec)
      renderRecordingsList(state.recordings)
      const cnt = el('rec-count')
      if (cnt) { cnt.textContent = state.recordings.length; cnt.style.display = 'inline-flex' }
      stream.getTracks().forEach(t => t.stop())

      // Upload automático ao Firebase via FFmpeg
      if (c && state.fbStorage) {
        const progEl = el('ffmpeg-progress')
        if (progEl) progEl.style.display = 'block'
        uploadRecordingToFirebase(c.id, blob, meta, ({ stage, pct }) => {
          if (progEl) {
            progEl.querySelector('.progress-fill').style.width = pct + '%'
            el('ffmpeg-progress-label').textContent = `${stage} (${pct}%)`
          }
        }).then(() => {
          if (progEl) progEl.style.display = 'none'
          el('ffmpeg-progress-label') && (el('ffmpeg-progress-label').textContent = '✓ Enviado ao Firebase')
        }).catch(err => {
          console.warn('[Upload]', err.message)
          if (progEl) progEl.style.display = 'none'
        })
      }
    }
    state.mediaRecorder.start(1000)
    clearInterval(state.recordingTimer)
    state.recordingTimer = setInterval(() => {
      state.recordingElapsed++
      const t = el('rec-timer'); if (t) t.textContent = formatTime(state.recordingElapsed)
    }, 1000)

    el('rec-btns').innerHTML = `<button class="btn btn-danger btn-sm" onclick="stopRecording()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" stroke="currentColor" stroke-width="1.5"/></svg>Parar Gravação</button>`
    el('rec-title').textContent = 'Gravando…'
    el('rec-timer').style.display = 'block'
    el('rec-icon-wrap').innerHTML = '<div class="record-dot"></div>'
    const card = el('recorder-card'); if (card) { card.style.background = 'rgba(239,68,68,0.04)'; card.style.borderColor = 'rgba(239,68,68,0.2)' }
  } catch (err) {
    el('rec-error').textContent = 'Erro ao acessar o microfone. Verifique as permissões do navegador.'; el('rec-error').style.display = 'block'
  }
}

window.stopRecording = function() {
  clearInterval(state.recordingTimer)
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') state.mediaRecorder.stop()
  el('rec-btns').innerHTML = `<button class="btn btn-primary btn-sm" onclick="startRecording()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>Iniciar Gravação</button><button class="btn btn-secondary btn-sm" onclick="el('audio-upload-input').click()">Upload de Áudio/Vídeo</button>`
  el('rec-title').textContent = 'Novo Depoimento'
  el('rec-timer').style.display = 'none'
  el('rec-icon-wrap').innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="color:var(--text-muted)"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" stroke-width="1.5"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
  const card = el('recorder-card'); if (card) { card.style.background = ''; card.style.borderColor = '' }
  set('transcript-content', `<div style="text-align:center;padding:32px">${spinner('spinner-lg')}<div style="font-size:13px;color:var(--text-muted);margin-top:14px">Processando gravação…</div></div>`)
  setTimeout(() => {
    set('transcript-content', `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Gravação processada</div><div style="font-size:13px;line-height:1.8;color:var(--text-secondary)">A gravação foi salva e enviada ao Firebase. Para transcrição automática, integre com Whisper API via Firebase Functions.</div>`)
    el('transcript-actions').style.display = 'block'
  }, 1500)
}

window.handleAudioUpload = function(e) {
  const file = e.target.files[0]; if (!file) return
  const c = state.selectedCase
  const meta = {
    name: `Upload — ${file.name}`,
    date: new Date().toLocaleDateString('pt-BR'),
    duration: '—',
    status: 'transcribed',
    caseId: c?.id,
  }
  const rec = { id: `rec_${Date.now()}`, ...meta, url: URL.createObjectURL(file), blob: file }
  state.recordings.unshift(rec)
  renderRecordingsList(state.recordings)
  const cnt = el('rec-count'); if (cnt) { cnt.textContent = state.recordings.length; cnt.style.display = 'inline-flex' }

  if (c && state.fbStorage) {
    const progEl = el('ffmpeg-progress')
    if (progEl) progEl.style.display = 'block'
    // Usa FFmpeg para converter antes de enviar
    const blobToUpload = file
    uploadRecordingToFirebase(c.id, blobToUpload, meta, ({ stage, pct }) => {
      if (progEl) {
        progEl.querySelector('.progress-fill').style.width = pct + '%'
        el('ffmpeg-progress-label').textContent = `${stage} (${pct}%)`
      }
    }).then(() => {
      if (progEl) progEl.style.display = 'none'
    }).catch(err => {
      console.warn('[Upload arquivo]', err.message)
      if (progEl) progEl.style.display = 'none'
    })
  }
}

function renderRecordingsList(recs) {
  if (!recs || !recs.length) {
    set('recordings-list', '<div class="empty-state"><div class="empty-icon">🎙️</div><div class="empty-desc">Nenhum depoimento gravado ainda.</div></div>')
    return
  }
  set('recordings-list', recs.map(v => `
    <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px;cursor:pointer" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background=''" onclick="selectRecording('${v.id}')">
      <div style="font-size:20px">🎙️</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.name}</div>
        <div style="font-size:11px;color:var(--text-muted)">${v.date} · ${v.duration}${v.storagePath ? ' · Firebase ✓' : ''}</div>
      </div>
      ${statusBadge(v.status || 'transcribed')}
      ${v.url ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();downloadRec('${v.id}')">⬇</button>` : ''}
    </div>
  `).join(''))
}

window.selectRecording = function(id) {
  const rec = state.recordings.find(r => r.id === id); if (!rec) return
  set('transcript-content', `
    <div style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:500;margin-bottom:8px">${rec.name}</div>
      <div style="display:flex;gap:8px">${statusBadge(rec.status || 'transcribed')}<span class="badge badge-neutral">${rec.duration}</span></div>
      ${rec.url ? `<audio controls src="${rec.url}" style="width:100%;margin-top:12px;height:36px"></audio>` : ''}
    </div>
    <div style="font-size:13px;line-height:1.8;color:var(--text-secondary)">Para transcrição automática, integre com Whisper API via Firebase Functions após o upload.</div>
  `)
  el('transcript-actions').style.display = 'block'
}

window.downloadRec = function(id) {
  const rec = state.recordings.find(r => r.id === id); if (!rec || !rec.url) return
  const a = document.createElement('a'); a.href = rec.url; a.download = rec.name.replace(/\s+/g,'_') + '.webm'; a.click()
}

window.exportTranscript = function() {
  const c = state.selectedCase
  const content = `TRANSCRIÇÃO — ${c?.title || 'Sem caso'}\nData: ${new Date().toLocaleDateString('pt-BR')}\n\nTranscrição automática disponível após integração com Whisper API via Firebase Functions.`
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' })); a.download = `transcricao_${(c?.title || 'depoimento').replace(/\s+/g,'_')}.txt`; a.click()
}

function formatTime(s) {
  const m = Math.floor(s / 60), sec = s % 60
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

// ─── REPORTS ──────────────────────────────────────────────────────

function renderReports() {
  const c = state.selectedCase
  const noCaseWarn = !c ? `<div class="alert-warn">⚠ Nenhum caso selecionado. Selecione um caso para gerar relatórios.</div>` : ''
  set('main-content', `
    ${noCaseWarn}
    <div class="grid-auto" style="align-items:start">
      <div>
        <div class="card" style="padding:22px;margin-bottom:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:18px">Gerar Relatório com IA</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            ${[['probatorio','Relatório Probatório','Análise completa de provas e riscos'],['audiencia','Memorando de Audiência','Preparação estratégica para audiência'],['contradicoes','Relatório de Contradições','Inconsistências detectadas pela IA'],['resumo','Resumo Executivo','Visão geral concisa do caso']].map(([val,label,desc]) => `
              <label style="cursor:pointer">
                <input type="radio" name="report-type" value="${val}" ${val==='probatorio'?'checked':''} style="display:none" />
                <div class="card" style="padding:14px;cursor:pointer;border:2px solid transparent" onclick="selectReportType(this,'${val}')">
                  <div style="font-size:13px;font-weight:500;margin-bottom:4px">${label}</div>
                  <div style="font-size:11px;color:var(--text-muted)">${desc}</div>
                </div>
              </label>`).join('')}
          </div>
          <button class="btn btn-primary" id="report-gen-btn" onclick="handleGenerateReport()">Gerar Relatório com IA</button>
        </div>
        <div id="report-output"></div>
      </div>
      <div class="card" style="padding:20px">
        <div class="section-muted" style="margin-bottom:14px">Caso Selecionado</div>
        ${c ? `
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">${c.title}</div>
          <div style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:12px">${c.number || '—'}</div>
          ${statusBadge(c.status)} ${riskBadge(c.riskLevel)}
          <div style="margin-top:12px;font-size:12px;color:var(--text-muted)">${c.court || '—'}</div>
        ` : '<div style="color:var(--text-muted);font-size:13px">Nenhum caso selecionado</div>'}
      </div>
    </div>
  `)
  const first = document.querySelector('[onclick*="probatorio"]')
  if (first) first.style.borderColor = 'var(--accent-blue)'
  window._selectedReportType = 'probatorio'
}

window.selectReportType = function(div, type) {
  document.querySelectorAll('[onclick*="selectReportType"]').forEach(d => d.style.borderColor = 'transparent')
  div.style.borderColor = 'var(--accent-blue)'
  window._selectedReportType = type
}

window.handleGenerateReport = async function() {
  const type = window._selectedReportType || 'probatorio'
  const c = state.selectedCase
  if (!c) { alert('Selecione um caso antes de gerar o relatório.'); return }
  const btn = el('report-gen-btn')
  btn.disabled = true; btn.innerHTML = `${spinner()} Gerando…`
  set('report-output', `<div style="text-align:center;padding:40px">${spinner('spinner-lg')}<div style="font-size:13px;color:var(--text-muted);margin-top:16px">A IA está redigindo o relatório…</div></div>`)
  try {
    const rep = await generateReport(type, c)
    state.reportContent = rep
    // Salva relatório no Firebase
    if (state.fbDb) {
      try { await addDoc(collection(state.fbDb, 'cases', c.id, 'reports'), { ...rep, content: rep.content, createdAt: serverTimestamp() }) } catch {}
    }
    renderReportResult(rep)
  } catch (e) {
    set('report-output', `<div class="alert-error">${e.message}</div>`)
  }
  btn.disabled = false; btn.textContent = 'Gerar Relatório com IA'
}

function renderReportResult(rep) {
  const formatted = rep.content.replace(/^## (.+)$/gm, '<div class="report-section-title">$1</div>')
  set('report-output', `
    <div class="card fade-up" style="padding:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div>
          <div style="font-size:15px;font-weight:600">${rep.label}</div>
          <div style="font-size:12px;color:var(--text-muted)">Gerado em ${new Date(rep.generatedAt).toLocaleString('pt-BR')}</div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="exportReport()">Exportar TXT</button>
      </div>
      <div class="report-content">${formatted}</div>
    </div>`)
}

window.exportReport = function() {
  if (!state.reportContent) return
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([state.reportContent.label + '\n\n' + state.reportContent.content], { type: 'text/plain' })); a.download = `relatorio_${state.reportContent.label.replace(/\s+/g,'_')}.txt`; a.click()
}

// ─── NEW CASE ─────────────────────────────────────────────────────

function renderNewCase() {
  state.newCaseStep = state.newCaseStep || 1
  const step = state.newCaseStep
  const d = state.newCaseData || {}
  const steps = ['Dados Básicos', 'Partes', 'Financeiro', 'Revisão']

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
          <div style="font-size:15px;font-weight:600;margin-bottom:24px">Dados Básicos do Caso</div>
          <div style="display:flex;flex-direction:column;gap:16px">
            <div class="field"><label>Título do Caso *</label><input type="text" id="nc-title" value="${d.title || ''}" placeholder="Ex.: Silva vs. Construtora Apex Ltda" /></div>
            <div class="grid-2">
              <div class="field"><label>Número do Processo</label><input type="text" id="nc-number" value="${d.number || ''}" placeholder="0000000-00.0000.0.00.0000" /></div>
              <div class="field"><label>Área do Direito</label><select id="nc-category"><option>Cível</option><option>Trabalhista</option><option>Empresarial</option><option>Família</option><option>Criminal</option><option>Tributário</option></select></div>
            </div>
            <div class="grid-2">
              <div class="field"><label>Status</label><select id="nc-status"><option value="active">Ativo</option><option value="pending">Pendente</option></select></div>
              <div class="field"><label>Nível de Risco</label><select id="nc-risk"><option value="low">Baixo</option><option value="medium">Médio</option><option value="high">Alto</option></select></div>
            </div>
            <div class="field"><label>Tribunal</label><input type="text" id="nc-court" value="${d.court || ''}" placeholder="Ex.: 1ª Vara Cível de São Paulo" /></div>
          </div>
        ` : step === 2 ? `
          <div style="font-size:15px;font-weight:600;margin-bottom:24px">Partes do Processo</div>
          <div style="display:flex;flex-direction:column;gap:16px">
            <div class="field"><label>Nome do Cliente *</label><input type="text" id="nc-client" value="${d.clientName || ''}" placeholder="Nome completo ou razão social" /></div>
            <div class="field"><label>Nome do Juiz(a)</label><input type="text" id="nc-judge" value="${d.judge || ''}" placeholder="Dr. Nome Sobrenome" /></div>
            <div class="field"><label>Parte Contrária</label><input type="text" id="nc-opposing" value="${d.opposing || ''}" placeholder="Nome da parte contrária" /></div>
            <div class="field"><label>Tags (separadas por vírgula)</label><input type="text" id="nc-tags" value="${(d.tags || []).join(', ')}" placeholder="Ex.: Cível, Indenização, Imobiliário" /></div>
          </div>
        ` : step === 3 ? `
          <div style="font-size:15px;font-weight:600;margin-bottom:24px">Informações Financeiras</div>
          <div style="display:flex;flex-direction:column;gap:16px">
            <div class="field"><label>Valor da Causa</label><input type="text" id="nc-value" value="${d.value || ''}" placeholder="R$ 0,00" /></div>
            <div class="field"><label>Data da Próxima Audiência</label><input type="date" id="nc-hearing" value="${d.nextHearing || ''}" style="background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-md);border-radius:var(--radius-sm);padding:8px 12px;font-family:inherit" /></div>
            <div class="field"><label>Observações</label><textarea id="nc-notes" placeholder="Informações adicionais relevantes…">${d.notes || ''}</textarea></div>
          </div>
        ` : `
          <div style="font-size:15px;font-weight:600;margin-bottom:24px">Revisão do Caso</div>
          ${Object.entries({ 'Título': d.title, 'Número': d.number, 'Cliente': d.clientName, 'Área': d.category, 'Tribunal': d.court, 'Juiz(a)': d.judge, 'Valor': d.value, 'Status': fmt.status(d.status), 'Risco': fmt.risk(d.riskLevel), 'Tags': (d.tags || []).join(', ') }).filter(([,v]) => v).map(([l, v]) => `
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
    d.title = el('nc-title')?.value; d.number = el('nc-number')?.value; d.status = el('nc-status')?.value; d.riskLevel = el('nc-risk')?.value; d.court = el('nc-court')?.value; d.category = el('nc-category')?.value
    if (dir === 1 && !d.title?.trim()) { alert('Informe o título do caso.'); return }
  } else if (state.newCaseStep === 2) {
    d.clientName = el('nc-client')?.value; d.judge = el('nc-judge')?.value; d.opposing = el('nc-opposing')?.value
    const tagsRaw = el('nc-tags')?.value || ''
    d.tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
    if (dir === 1 && !d.clientName?.trim()) { alert('Informe o nome do cliente.'); return }
  } else if (state.newCaseStep === 3) {
    d.value = el('nc-value')?.value; d.nextHearing = el('nc-hearing')?.value || null; d.notes = el('nc-notes')?.value
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
    state.selectedCase = c
    state.cases.unshift(c)
    state.newCaseStep = 1; state.newCaseData = {}
    navigate('case-detail', document.querySelector('.nav-item[data-page="case-detail"]'))
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
            <div style="font-size:12px;color:var(--text-muted)">Motor de IA para roteiros, análises e relatórios</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="field"><label>API Key * — obtenha em <a href="https://console.groq.com" target="_blank" style="color:var(--accent-blue)">console.groq.com</a></label><input type="password" id="cfg-groq-key" value="${cfg.groqApiKey || ''}" placeholder="gsk_…" style="font-family:var(--font-mono);font-size:12px" /></div>
          <div class="field">
            <label>Modelo</label>
            <select id="cfg-groq-model">
              <option value="llama-3.3-70b-versatile" ${(cfg.groqModel||'llama-3.3-70b-versatile')==='llama-3.3-70b-versatile'?'selected':''}>llama-3.3-70b-versatile (Recomendado)</option>
              <option value="llama3-70b-8192" ${cfg.groqModel==='llama3-70b-8192'?'selected':''}>llama3-70b-8192</option>
              <option value="llama3-8b-8192" ${cfg.groqModel==='llama3-8b-8192'?'selected':''}>llama3-8b-8192 (Rápido)</option>
              <option value="mixtral-8x7b-32768" ${cfg.groqModel==='mixtral-8x7b-32768'?'selected':''}>mixtral-8x7b-32768</option>
            </select>
          </div>
          <div id="groq-test-result"></div>
          <button class="btn btn-secondary" id="groq-test-btn" onclick="testGroq()">Testar conexão Groq</button>
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
    set('groq-test-result', `<div style="background:var(--risk-high-subtle);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-sm);padding:8px 12px;font-size:12px;color:var(--risk-high)">✗ Erro: ${e.message}</div>`)
  }
  btn.disabled = false; btn.textContent = 'Testar conexão Groq'
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