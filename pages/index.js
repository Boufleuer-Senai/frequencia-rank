import { useState } from 'react';

export default function Home() {
  const [senha, setSenha] = useState('');
  const [turma, setTurma] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const [ranking, setRanking] = useState([]);
  const [mediaTurma, setMediaTurma] = useState(null);
  const [turmaAtual, setTurmaAtual] = useState('');

  const enviar = async () => {
    setErro('');
    if (!senha) return setErro('Informe a senha');
    if (!turma) return setErro('Informe o nome da turma');
    if (!pdfFile) return setErro('Selecione um arquivo PDF');

    setLoading(true);

    const formData = new FormData();
    formData.append('senha', senha);
    formData.append('turma', turma);
    formData.append('pdf', pdfFile);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || 'Erro desconhecido');
        setLoading(false);
        return;
      }
      setRanking(json.ranking);
      setMediaTurma(json.mediaTurma);
      setTurmaAtual(json.turma);
      setLoading(false);
    } catch (e) {
      setErro('Erro ao enviar');
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
          type="text"
          placeholder="Nome da Turma"
          value={turma}
          onChange={(e) => setTurma(e.target.value)}
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

        {mediaTurma !== null && (
          <div style={styles.card}>
            <h2>Turma: {turmaAtual}</h2>
            <p>Média da frequência: {mediaTurma}%</p>
          </div>
        )}

        {ranking.length > 0 && (
          <div style={styles.card}>
            <h2>Ranking Geral</h2>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Frequência (%)</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((aluno, i) => (
                  <tr key={i}>
                    <td>{aluno.nome}</td>
                    <td>{aluno.frequencia}</td>
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
    backgroundColor: '#121212',
    color: '#eee',
    minHeight: '100vh',
    padding: 20,
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  container: {
    maxWidth: 600,
    width: '100%',
    backgroundColor: '#222',
    borderRadius: 8,
    padding: 30,
    boxShadow: '0 0 15px #0f0',
  },
  title: {
    textAlign: 'center',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    padding: 12,
    marginBottom: 15,
    borderRadius: 6,
    border: 'none',
    fontSize: 16,
    outline: 'none',
  },
  button: {
    width: '100%',
    padding: 15,
    backgroundColor: '#0f0',
    border: 'none',
    borderRadius: 6,
    fontWeight: 'bold',
    fontSize: 18,
    cursor: 'pointer',
    color: '#000',
  },
  erro: {
    color: '#f33',
    marginTop: 10,
    textAlign: 'center',
  },
  card: {
    marginTop: 30,
    backgroundColor: '#333',
    borderRadius: 8,
    padding: 20,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: 10,
  },
};
