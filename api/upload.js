import multiparty from 'multiparty';
import pdfParse from 'pdf-parse';

export const config = { api: { bodyParser: false } };

// ENV
const GH_TOKEN  = process.env.GITHUB_TOKEN;
const GH_OWNER  = process.env.GH_OWNER;
const GH_REPO   = process.env.GH_REPO;
const GH_BRANCH = process.env.GH_BRANCH || 'main';
const SENHA     = process.env.SENHA;

if (!GH_TOKEN || !GH_OWNER || !GH_REPO) console.error('[ENV] GH_* faltando');

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
  // se existir, precisamos do sha para atualizar
  let sha = undefined;
  const current = await ghGet(path);
  if (current && current.sha) sha = current.sha;

  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch: GH_BRANCH,
  };
  if (sha) body.sha = sha;

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

function slugifyTurma(t) {
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function extrairFrequencia(texto) {
  const linhas = texto.split('\n');
  const alunos = [];
  for (let linha of linhas) {
    if (linha.includes('Matriculad')) {
      const m = linha.match(/(\d{1,3},\d{2})/);
      if (!m) continue;
      const partes = linha.trim().split(/\s+/);
      const nomePartes = [];
      for (let p of partes) {
        if (/^\d+$/.test(p)) break; // para na matrícula
        nomePartes.push(p);
      }
      const nome = nomePartes.join(' ').trim();
      const frequencia = parseFloat(m[1].replace(',', '.'));
      if (nome && !Number.isNaN(frequencia)) alunos.push({ nome, frequencia });
    }
  }
  return alunos;
}

function calcularMedia(alunos) {
  if (!alunos.length) return 0;
  const soma = alunos.reduce((acc, a) => acc + a.frequencia, 0);
  return Math.round((soma / alunos.length) * 100) / 100;
}

async function listarTurmasJSON() {
  // lista arquivos em data/turmas
  const dir = await ghGet('data/turmas');
  if (!dir) return [];
  if (!Array.isArray(dir)) throw new Error('[GH LIST] retorno inesperado');
  return dir.filter((x) => x.type === 'file' && x.name.endsWith('.json'));
}

async function carregarJSONSha(item) {
  // item.content pode não vir, então usamos download_url
  const res = await fetch(item.download_url);
  if (!res.ok) throw new Error(`[RAW GET] ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const form = new multiparty.Form();
    form.parse(req, async (err, fields, files) => {
      if (err) return res.status(500).json({ error: 'Erro no upload' });

      const senha = fields.senha?.[0];
      if (senha !== SENHA) return res.status(401).json({ error: 'Senha inválida' });

      if (!files.pdf?.length) return res.status(400).json({ error: 'Arquivo PDF não enviado' });

      const fs = require('fs');
      const file = files.pdf[0];
      let texto = '';
      try {
        const data = await pdfParse(fs.readFileSync(file.path));
        texto = data.text || '';
      } catch (e) {
        console.error('[PDF]', e);
        return res.status(500).json({ error: 'Erro ao processar PDF' });
      }

      const alunos = extrairFrequencia(texto);
      if (!alunos.length) return res.status(400).json({ error: 'Nenhum dado válido encontrado no PDF' });

      const media = calcularMedia(alunos);
      const turmaNome = (fields.turma?.[0] || file.originalFilename || 'Turma sem nome').trim();
      const turmaSlug = slugifyTurma(turmaNome);

      // grava turma
      const turmaPayload = JSON.stringify({ turma: turmaNome, media, alunos }, null, 2);
      await ghPut(`data/turmas/${turmaSlug}.json`, turmaPayload, `upsert turma ${turmaNome}`);

      // recalc ranking geral
      const arquivos = await listarTurmasJSON();
      let rankingGeral = [];
      for (const item of arquivos) {
        const tjson = await carregarJSONSha(item);
        rankingGeral = rankingGeral.concat(tjson.alunos || []);
      }
      const map = new Map();
      rankingGeral.forEach((a) => {
        if (!map.has(a.nome) || map.get(a.nome) < a.frequencia) map.set(a.nome, a.frequencia);
      });
      const rankingFinal = Array.from(map.entries())
        .map(([nome, frequencia]) => ({ nome, frequencia }))
        .sort((a, b) => b.frequencia - a.frequencia);

      const rankingPayload = JSON.stringify({ atualizadoEm: new Date().toISOString(), ranking: rankingFinal }, null, 2);
      await ghPut(`data/ranking.json`, rankingPayload, `rebuild ranking`);

      return res.status(200).json({ turma: turmaNome, mediaTurma: media, ranking: rankingFinal });
    });
  } catch (e) {
    console.error('[FATAL]', e);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
