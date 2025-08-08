import pdfParse from 'pdf-parse';
import multiparty from 'multiparty';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

// ENV check
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const senhaServidor = process.env.SENHA;
if (!supabaseUrl) console.error('[ENV] Falta NEXT_PUBLIC_SUPABASE_URL');
if (!supabaseKey) console.error('[ENV] Falta SUPABASE_SERVICE_ROLE_KEY');
if (!senhaServidor) console.error('[ENV] Falta SENHA');

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

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
        if (/^\d+$/.test(p)) break; // para no primeiro bloco numérico (matrícula)
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const form = new multiparty.Form();
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('[UPLOAD] multiparty:', err);
      return res.status(500).json({ error: 'Erro no upload' });
    }

    const senha = fields.senha?.[0];
    if (senha !== senhaServidor) return res.status(401).json({ error: 'Senha inválida' });

    if (!files.pdf?.length) return res.status(400).json({ error: 'Arquivo PDF não enviado' });

    const fs = require('fs');
    const file = files.pdf[0];
    let texto = '';
    try {
      const data = await pdfParse(fs.readFileSync(file.path));
      texto = data.text || '';
    } catch (e) {
      console.error('[PDF] parse:', e);
      return res.status(500).json({ error: 'Erro ao processar PDF' });
    }

    const alunos = extrairFrequencia(texto);
    if (!alunos.length) {
      console.error('[PARSE] nenhum aluno encontrado. Amostra:', texto.slice(0, 400));
      return res.status(400).json({ error: 'Nenhum dado válido encontrado no PDF' });
    }

    const media = calcularMedia(alunos);
    const turma = (fields.turma?.[0] || file.originalFilename || 'Turma sem nome').trim();

    try {
      // 🔥 Sem SELECT: UPSERT resolve criar/atualizar pela coluna única 'turma'
      const { error: upsertError } = await supabase
        .from('ranking')
        .upsert([{ turma, alunos, media }], { onConflict: 'turma' });

      if (upsertError) {
        console.error('[DB][UPSERT]', upsertError);
        return res.status(500).json({ error: 'Erro ao acessar banco (upsert)' });
      }

      // Lista tudo para montar o ranking geral
      const { data: todasTurmas, error: listError } = await supabase
        .from('ranking')
        .select('turma, alunos, media');

      if (listError) {
        console.error('[DB][LIST]', listError);
        return res.status(500).json({ error: 'Erro ao acessar banco (list)' });
      }

      let rankingGeral = [];
      (todasTurmas || []).forEach((t) => rankingGeral = rankingGeral.concat(t.alunos || []));

      const map = new Map();
      rankingGeral.forEach((a) => {
        if (!map.has(a.nome) || map.get(a.nome) < a.frequencia) map.set(a.nome, a.frequencia);
      });

      const rankingFinal = Array.from(map.entries())
        .map(([nome, frequencia]) => ({ nome, frequencia }))
        .sort((a, b) => b.frequencia - a.frequencia);

      return res.status(200).json({ mediaTurma: media, turma, ranking: rankingFinal });
    } catch (dbErr) {
      console.error('[DB][FATAL]', dbErr);
      return res.status(500).json({ error: 'Erro ao acessar banco (fatal)' });
    }
  });
}
