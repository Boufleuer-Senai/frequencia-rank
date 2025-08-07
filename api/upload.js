import pdfParse from 'pdf-parse';
import multiparty from 'multiparty';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

// ===== Checks de ambiente (logam em produção) =====
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const senhaServidor = process.env.SENHA;

if (!supabaseUrl) console.error('[ENV] Falta NEXT_PUBLIC_SUPABASE_URL');
if (!supabaseKey) console.error('[ENV] Falta SUPABASE_SERVICE_ROLE_KEY');
if (!senhaServidor) console.error('[ENV] Falta SENHA');

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

function extrairFrequencia(texto) {
  // Parser mais robusto pro PDF do SENAI
  const linhas = texto.split('\n');
  const alunos = [];
  for (let linha of linhas) {
    if (linha.includes('Matriculad')) {
      const matchFreq = linha.match(/(\d{1,3},\d{2})/);
      if (!matchFreq) continue;

      // nome = tudo até o primeiro bloco numérico (matrícula)
      const partes = linha.trim().split(/\s+/);
      const nomePartes = [];
      for (let p of partes) {
        if (/^\d+$/.test(p)) break;
        nomePartes.push(p);
      }
      const nome = nomePartes.join(' ').trim();
      const frequencia = parseFloat(matchFreq[1].replace(',', '.'));
      if (nome && !Number.isNaN(frequencia)) {
        alunos.push({ nome, frequencia });
      }
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

  try {
    const form = new multiparty.Form();
    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('[UPLOAD] Erro parse multiparty:', err);
        return res.status(500).json({ error: 'Erro no upload' });
      }

      const senha = fields.senha?.[0];
      if (senha !== senhaServidor) return res.status(401).json({ error: 'Senha inválida' });

      if (!files.pdf || files.pdf.length === 0)
        return res.status(400).json({ error: 'Arquivo PDF não enviado' });

      const file = files.pdf[0];
      const fs = require('fs');
      const fileBuffer = fs.readFileSync(file.path);

      let texto;
      try {
        const data = await pdfParse(fileBuffer);
        texto = data.text || '';
      } catch (e) {
        console.error('[PDF] Falha ao extrair texto:', e);
        return res.status(500).json({ error: 'Erro ao processar PDF' });
      }

      const alunos = extrairFrequencia(texto);
      if (!alunos.length) {
        console.error('[PARSE] Nenhum aluno encontrado. Amostra do texto:', texto.slice(0, 500));
        return res.status(400).json({ error: 'Nenhum dado válido encontrado no PDF' });
      }

      const media = calcularMedia(alunos);
      const turma = (fields.turma?.[0] || file.originalFilename || 'Turma sem nome').trim();

      // ===== SUPABASE START =====
      try {
        // SELECT turma
        const { data: turmaExistente, error: selectError } = await supabase
          .from('ranking')
          .select('*')
          .eq('turma', turma)
          .single();

        if (selectError && selectError.code !== 'PGRST116') {
          console.error('[DB][SELECT] Erro:', selectError);
          return res.status(500).json({ error: 'Erro ao acessar banco (select)' });
        }

        if (turmaExistente) {
          const { error: updateError } = await supabase
            .from('ranking')
            .update({ alunos, media })
            .eq('turma', turma);
          if (updateError) {
            console.error('[DB][UPDATE] Erro:', updateError);
            return res.status(500).json({ error: 'Erro ao acessar banco (update)' });
          }
        } else {
          const { error: insertError } = await supabase
            .from('ranking')
            .insert([{ turma, alunos, media }]);
          if (insertError) {
            console.error('[DB][INSERT] Erro:', insertError);
            return res.status(500).json({ error: 'Erro ao acessar banco (insert)' });
          }
        }

        // Busca geral
        const { data: todasTurmas, error: listError } = await supabase.from('ranking').select('*');
        if (listError) {
          console.error('[DB][LIST] Erro:', listError);
          return res.status(500).json({ error: 'Erro ao acessar banco (list)' });
        }

        let rankingGeral = [];
        (todasTurmas || []).forEach((t) => (rankingGeral = rankingGeral.concat(t.alunos || [])));

        const map = new Map();
        rankingGeral.forEach((a) => {
          if (!map.has(a.nome) || map.get(a.nome) < a.frequencia) {
            map.set(a.nome, a.frequencia);
          }
        });

        const rankingFinal = Array.from(map.entries())
          .map(([nome, frequencia]) => ({ nome, frequencia }))
          .sort((a, b) => b.frequencia - a.frequencia);

        return res.status(200).json({ mediaTurma: media, turma, ranking: rankingFinal });
      } catch (dbErr) {
        console.error('[DB][FATAL] Erro inesperado:', dbErr);
        return res.status(500).json({ error: 'Erro ao acessar banco (fatal)' });
      }
      // ===== SUPABASE END =====
    });
  } catch (outer) {
    console.error('[HANDLER] Erro não tratado:', outer);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
