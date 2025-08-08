import multiparty from 'multiparty';
import pdfParse from 'pdf-parse';

export const config = { api: { bodyParser: false } };

// ENVs (Vercel → Settings → Environment Variables)
const GH_TOKEN  = process.env.GITHUB_TOKEN;
const GH_OWNER  = process.env.GH_OWNER;           // ex: "Boufleuer-Senai"
const GH_REPO   = process.env.GH_REPO;            // ex: "frequencia-rank-data"
const GH_BRANCH = process.env.GH_BRANCH || 'main';
const SENHA     = process.env.SENHA;

const baseApi = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents`;

async function ghGet(path) {
  const res = await fetch(`${baseApi}/${path}?ref=${GH_BRANCH}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, 'User-Agent': 'vercel-func' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`[GH GET] ${res.status} ${await res.text()}`);
  return res.json();
}
async function ghPut(path, content, message) {
  let sha;
  const current = await ghGet(path);
  if (current?.sha) sha = current.sha;

  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch: GH_BRANCH,
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(`${baseApi}/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'vercel-func',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`[GH PUT] ${res.status} ${await res.text()}`);
  return res.json();
}

function slugify(t) {
  return t.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Extrai alunos (PDF SENAI): linha com nome + matrícula + "Matriculad" + 99,99
function extrairFrequencia(texto) {
  const re = /(?:^|\n)\s*([A-ZÀ-ÿ][A-ZÀ-ÿ\s.'-]+?)\s*\d{4,}[\s\S]*?Matriculad\s+(\d{1,3},\d{2})/gmi;
  const alunos = [];
  let m;
  while ((m = re.exec(texto)) !== null) {
    const nome = m[1].replace(/\s+/g, ' ').trim();
    const frequencia = parseFloat(m[2].replace(',', '.'));
    if (nome && !Number.isNaN(frequencia)) alunos.push({ nome, frequencia });
  }
  return alunos;
}
function calcularMedia(alunos) {
  if (!alunos.length) return 0;
  const soma = alunos.reduce((acc, a) => acc + a.frequencia, 0);
  return Math.round((soma / alunos.length) * 100) / 100;
}
function detectarTurma(texto, filename) {
  const m1 = texto.match(/Turma:\s*([^\n\r]+)/i);
  if (m1?.[1]) return m1[1].trim();
  const m2 = texto.match(/(T\s*\d+[^-\n\r]*?(?:[º°]?\s*CICLO)?)/i);
  if (m2?.[1]) return m2[1].replace(/\s+/g, ' ').trim();
  const m3 = texto.match(/\bINP\d{4}\.\d{4}-\d{5}\b/i);
  if (m3?.[0]) return m3[0];
  const base = (filename || 'Turma').replace(/\.[^.]+$/, '');
  return base;
}

async function listarTurmasOrdenadas() {
  const dir = await ghGet('data/turmas');
  if (!dir) return [];
  const files = Array.isArray(dir) ? dir.filter(f => f.type === 'file' && f.name.endsWith('.json')) : [];
  const out = [];
  for (const f of files) {
    const r = await fetch(f.download_url);
    if (!r.ok) continue;
    const j = await r.json();
    out.push({
      turma: j.turma || f.name.replace(/\.json$/,''),
      media: Number(j.media) || 0,
      qtd: j.qtd || 0,
      atualizadoEm: j.atualizadoEm || null
    });
  }
  out.sort((a,b) => b.media - a.media); // maior média primeiro
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) return res.status(500).json({ error: 'Config do servidor ausente' });

  const form = new multiparty.Form();
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Erro no upload' });
    if ((fields.senha?.[0] || '') !== SENHA) return res.status(401).json({ error: 'Senha inválida' });
    if (!files.pdf?.length) return res.status(400).json({ error: 'Arquivo PDF não enviado' });

    const fs = require('fs');
    const file = files.pdf[0];

    let texto = '';
    try {
      const data = await pdfParse(fs.readFileSync(file.path));
      texto = data.text || '';
    } catch {
      return res.status(500).json({ error: 'Erro ao processar PDF' });
    }

    const alunos = extrairFrequencia(texto);
    if (!alunos.length) return res.status(400).json({ error: 'Nenhum dado válido encontrado no PDF' });

    const media = calcularMedia(alunos);
    const turmaNome = detectarTurma(texto, file.originalFilename);
    const turmaSlug = slugify(turmaNome);

    try {
      // UPSERT da turma (substitui se existir, mantém as demais)
      const payload = JSON.stringify(
        { turma: turmaNome, media, qtd: alunos.length, atualizadoEm: new Date().toISOString() },
        null,
        2
      );
      await ghPut(`data/turmas/${turmaSlug}.json`, payload, `upsert turma ${turmaNome}`);

      // Lista todas e ordena por média desc (maior em primeiro)
      const turmasOrdenadas = await listarTurmasOrdenadas();

      return res.status(200).json({
        turma: turmaNome,
        mediaTurma: media,
        turmas: turmasOrdenadas
      });
    } catch (e) {
      console.error('[GH]', e);
      return res.status(500).json({ error: 'Falha ao salvar dados' });
    }
  });
}
