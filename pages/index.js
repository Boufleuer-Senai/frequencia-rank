import { useState } from 'react';

export default function Home() {
  const [senha, setSenha] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const [turma, setTurma] = useState('');
  const [media, setMedia] = useState(null);
  const [turmas, setTurmas] = useState([]);

  const enviar = async () => {
    setErro('');
    if (!senha) return setErro('Informe a senha');
    if (!pdfFile) return setErro('Selecione um arquivo PDF');
    setLoading(true);

    const formData = new FormData();
    formData.append('senha', senha);
    formData.append('pdf', pdfFile);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok) setErro(json.error || 'Erro desconhecido');
      else {
        setTurma(json.turma);
        setMedia(json.mediaTurma);
        setTurmas(json.turmas || []);
      }
    } catch {
      setErro('Erro ao enviar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.body}>
      <div style={styles.container}>
        <h1 style={styles.title}>Login & Upload de Frequência</h1>

        <input
          type="password"
          placeholder="Senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          style={styles.input}
        />
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setPdfFile(e.target.files[0])}
          style={styles.input}
        />
        <button onClick={enviar} disabled={loading} style={styles.button}>
          {loading ? 'Processando...' : 'Enviar PDF'}
        </button>
        {erro && <p style={styles.erro}>{erro}</p>}

        {media !== null && (
          <div style={styles.card}>
            <h2>Turma processada: {turma}</h2>
            <p>Média da frequência: <b>{media}%</b></p>
          </div>
        )}

        {turmas.length > 0 && (
          <div style={styles.card}>
            <h2>Turmas cadastradas (maior média primeiro)</h2>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Turma</th>
                  <th>Média (%)</th>
                  <th>Alunos</th>
                </tr>
              </thead>
              <tbody>
                {turmas.map((t, i) => (
                  <tr key={t.turma + i} style={i === 0 ? styles.topRow : undefined}>
                    <td>{i + 1}</td>
                    <td>{t.turma}</td>
                    <td>{t.media}</td>
                    <td>{t.qtd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  body: {
    backgroundColor: '#121212', color: '#eee', minHeight: '100vh', padding: 20,
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", display: 'flex',
    justifyContent: 'center', alignItems: 'flex-start',
  },
  container: {
    maxWidth: 700, width: '100%', backgroundColor: '#222', borderRadius: 8,
    padding: 30, boxShadow: '0 0 15px #0f0',
  },
  title: { textAlign: 'center', marginBottom: 20 },
  input: { width: '100%', padding: 12, marginBottom: 15, borderRadius: 6, border: 'none', fontSize: 16 },
  button: {
    width: '100%', padding: 15, backgroundColor: '#0f0', border: 'none', borderRadius: 6,
    fontWeight: 'bold', fontSize: 18, cursor: 'pointer', color: '#000',
  },
  erro: { color: '#f33', marginTop: 10, textAlign: 'center' },
  card: { marginTop: 30, backgroundColor: '#333', borderRadius: 8, padding: 20 },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 10 },
  topRow: { fontWeight: 'bold', borderTop: '2px solid #0f0', borderBottom: '2px solid #0f0' },
};
