import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Download, Youtube, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

type Folder = {
  id: number;
  nome: string;
};

type VideoResponse = {
  success: boolean;
  video: {
    nome: string;
    id: number;
    url: string;
    tamanho: number;
    duracao: number;
  };
  message: string;
};

export default function BaixarYoutube() {
  const { getToken } = useAuth();
  const [url, setUrl] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [idPasta, setIdPasta] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [urlValid, setUrlValid] = useState<boolean | null>(null);

  useEffect(() => {
    const carregarPastas = async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('Usuário não autenticado');

        const response = await fetch('/api/folders', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Erro ao carregar pastas');
        }

        const data: Folder[] = await response.json();
        setFolders(data);
      } catch (err) {
        toast.error('Erro ao carregar pastas');
      }
    };

    carregarPastas();
  }, [getToken]);

  const validateYouTubeUrl = (url: string) => {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    return youtubeRegex.test(url);
  };

  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl);
    
    if (newUrl.trim()) {
      const isValid = validateYouTubeUrl(newUrl);
      setUrlValid(isValid);
    } else {
      setUrlValid(null);
    }
  };

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!url || !idPasta) {
      toast.warning('Preencha o link e selecione uma pasta');
      return;
    }

    if (!validateYouTubeUrl(url)) {
      toast.error('URL deve ser do YouTube (youtube.com ou youtu.be)');
      return;
    }

    try {
      setLoading(true);
      const token = await getToken();
      if (!token) throw new Error('Usuário não autenticado');

      const response = await fetch('/api/downloadyoutube', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          url,
          id_pasta: idPasta,
        }),
      });

      const data: VideoResponse = await response.json();

      if (response.ok && data.success) {
        toast.success(data.message || `✅ Vídeo "${data.video.nome}" baixado com sucesso!`);
        setUrl('');
        setIdPasta('');
        setUrlValid(null);
      } else {
        throw new Error(data.error || 'Erro ao baixar vídeo');
      }
    } catch (err: any) {
      console.error('Erro no download:', err);
      toast.error(err.message || 'Erro ao baixar vídeo');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Youtube className="h-8 w-8 text-red-600" />
        <h1 className="text-3xl font-bold text-gray-900">Download do YouTube</h1>
      </div>

      {/* Informações de ajuda */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start">
          <AlertCircle className="h-5 w-5 text-blue-600 mr-3 mt-0.5" />
          <div>
            <h3 className="text-blue-900 font-medium mb-2">Como usar</h3>
            <ul className="text-blue-800 text-sm space-y-1">
              <li>• Cole o link do vídeo do YouTube que deseja baixar</li>
              <li>• Selecione a pasta onde o vídeo será salvo</li>
              <li>• Clique em "Baixar Vídeo" e aguarde o download</li>
              <li>• O vídeo será salvo automaticamente na pasta selecionada</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-md">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Download className="w-5 h-5" /> Baixar vídeo do YouTube
        </h2>

        <form onSubmit={handleDownload} className="space-y-4">
          <div>
            <label className="block mb-1 font-medium">Link do YouTube *</label>
            <div className="relative">
              <input
                type="url"
                className={`w-full border rounded-lg px-3 py-2 pr-10 ${
                  urlValid === false ? 'border-red-500' : 
                  urlValid === true ? 'border-green-500' : 'border-gray-300'
                }`}
                placeholder="https://youtube.com/watch?v=... ou https://youtu.be/..."
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                required
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                {urlValid === true && (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                )}
                {urlValid === false && (
                  <AlertCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
            </div>
            {urlValid === false && (
              <p className="mt-1 text-sm text-red-600">
                URL deve ser do YouTube (youtube.com ou youtu.be)
              </p>
            )}
            {urlValid === true && (
              <p className="mt-1 text-sm text-green-600">
                URL válida do YouTube
              </p>
            )}
          </div>

          <div>
            <label className="block mb-1 font-medium">Selecionar Pasta *</label>
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={idPasta}
              onChange={(e) => setIdPasta(e.target.value)}
              required
            >
              <option value="">Selecione uma pasta</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id.toString()}>
                  {folder.nome}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center w-full"
            disabled={loading || !urlValid}
          >
            {loading ? (
              <>
                <Loader className="h-5 w-5 mr-2 animate-spin" />
                Baixando...
              </>
            ) : (
              <>
                <Download className="h-5 w-5 mr-2" />
                Baixar Vídeo
              </>
            )}
          </button>
        </form>

        {/* Informações adicionais */}
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-medium text-gray-800 mb-2">ℹ️ Informações importantes</h3>
          <ul className="text-gray-600 text-sm space-y-1">
            <li>• Apenas vídeos públicos podem ser baixados</li>
            <li>• O download pode levar alguns minutos dependendo do tamanho do vídeo</li>
            <li>• Vídeos são salvos no formato MP4 com melhor qualidade disponível</li>
            <li>• Respeite os direitos autorais dos criadores de conteúdo</li>
          </ul>
        </div>
      </div>
    </div>
  );
}