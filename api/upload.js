import pdfParse from 'pdf-parse';
import multiparty from 'multiparty';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function extrairFrequencia(texto) {
  const linhas = texto.split('\n');
  const alunos = [];

  for (let linha of linhas) {
    // Só processa linhas que terminam com "Matriculado"
    if (linha.includes('Matriculad') && linha.match(/\d{2},\d{2}/)) {
      const partes = linha.trim().split(/\s+/);
      const nomePartes = [];

      for (let parte of partes) {
        if (!parte.match(/^\d+$/)) {
          nomePartes.push(parte);
        } else {
          break;
        }
      }

      const nome = nomePartes.join(' ');
      const matchFreq = linha.match(/(\d{2},\d{2})/);

      if (nome && matchFreq) {
        const freq = parseFloat(matchFreq[1].replace(',', '.'));
        alunos.push({ nome, frequencia: freq });
      }
    }
  }

  return alunos;
}

function calcularMedia(alunos) {
  if (alunos.length === 0) return 0;
  const soma = alunos.reduce((acc, a) => acc + a.frequencia, 0);
  return Math.round((soma / alunos.length) * 100) / 100;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const form = new multiparty.Form();
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Erro no upload' });

    const senha = fields.senha?.[0];
    if (senha !== process.env.SENHA) return res.status(401).json({ error: 'Senha inválida' });

    if (!files.pdf || files.pdf.length === 0)
      return res.status(400).json({ error: 'Arquivo PDF não enviado' });

    const file = files.pdf[0];
    const fs = require('fs');
    const fileBuffer = fs.readFileSync(file.path);

    try {
      const data = await pdfParse(fileBuffer);
      const texto = data.text;

      const alunos = extrairFrequencia(texto);
      if (alunos.length === 0)
        return res.status(400).json({ error: 'Nenhum dado válido encontrado no PDF' });

      const media = calcularMedia(alunos);
      const turma = fields.turma?.[0] || file.originalFilename || 'Turma sem nome';

      const { data: turmaExistente, error } = await supabase
        .from('ranking')
        .select('*')
        .eq('turma', turma)
        .single();

      if (error && error.code !== 'PGRST116') {
        return res.status(500).json({ error: 'Erro ao acessar banco' });
      }

      if (turmaExistente) {
        await supabase.from('ranking').update({ alunos, media }).eq('turma', turma);
      } else {
        await supabase.from('ranking').insert([{ turma, alunos, media }]);
      }

      const { data: todasTurmas } = await supabase.from('ranking').select('*');

      let rankingGeral = [];
      todasTurmas.forEach((t) => {
        rankingGeral = rankingGeral.concat(t.alunos);
      });

      const mapRanking = new Map();
      rankingGeral.forEach((a) => {
        if (!mapRanking.has(a.nome) || mapRanking.get(a.nome) < a.frequencia) {
          mapRanking.set(a.nome, a.frequencia);
        }
      });

      const rankingFinal = Array.from(mapRanking.entries())
        .map(([nome, frequencia]) => ({ nome, frequencia }))
        .sort((a, b) => b.frequencia - a.frequencia);

      res.status(200).json({ mediaTurma: media, turma, ranking: rankingFinal });
    } catch (e) {
      console.error('Erro ao processar PDF:', e);
      res.status(500).json({ error: 'Erro ao processar PDF' });
    }
  });
}
