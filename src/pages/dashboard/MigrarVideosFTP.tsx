import React, { useState, useEffect } from 'react';
import { ChevronLeft, Server, Upload, Eye, EyeOff, AlertCircle, CheckCircle, Download, Folder, Play, Trash2, FolderOpen, Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../../context/AuthContext';

interface FTPConnection {
  ip: string;
  usuario: string;
  senha: string;
  porta: number;
}

interface FTPFile {
  name: string;
  size: number;
  type: 'file' | 'directory';
  path: string;
  isVideo: boolean;
}

interface FTPVideo {
  name: string;
  path: string;
  size: number;
  directory: string;
}

interface Folder {
  id: number;
  nome: string;
}

interface MigrationProgress {
  fileName: string;
  progress: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  error?: string;
}

const MigrarVideosFTP: React.FC = () => {
  const { getToken } = useAuth();
  const [ftpData, setFtpData] = useState<FTPConnection>({
    ip: '',
    usuario: '',
    senha: '',
    porta: 21
  });
  
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [ftpFiles, setFtpFiles] = useState<FTPFile[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress[]>([]);
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [scanningDirectory, setScanningDirectory] = useState(false);
  const [directoryVideos, setDirectoryVideos] = useState<FTPVideo[]>([]);
  const [showDirectoryModal, setShowDirectoryModal] = useState(false);
  const [selectedDirectoryPath, setSelectedDirectoryPath] = useState('');

  useEffect(() => {
    loadFolders();
  }, []);

  const loadFolders = async () => {
    try {
      const token = await getToken();
      const response = await fetch('/api/folders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      setFolders(data);
    } catch (error) {
      toast.error('Erro ao carregar pastas');
    }
  };

  const handleInputChange = (field: keyof FTPConnection, value: string | number) => {
    setFtpData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const connectToFTP = async () => {
    if (!ftpData.ip || !ftpData.usuario || !ftpData.senha) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }

    setIsConnecting(true);
    try {
      const token = await getToken();
      const response = await fetch('/api/ftp/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(ftpData)
      });

      const result = await response.json();

      if (result.success) {
        setIsConnected(true);
        setFtpFiles(result.files || []);
        setCurrentPath(result.currentPath || '/');
        toast.success('Conectado ao FTP com sucesso!');
      } else {
        toast.error(result.error || 'Erro ao conectar ao FTP');
      }
    } catch (error) {
      console.error('Erro ao conectar:', error);
      toast.error('Erro ao conectar ao FTP');
    } finally {
      setIsConnecting(false);
    }
  };

  const navigateToDirectory = async (path: string) => {
    try {
      const token = await getToken();
      const response = await fetch('/api/ftp/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...ftpData,
          path
        })
      });

      const result = await response.json();

      if (result.success) {
        setFtpFiles(result.files || []);
        setCurrentPath(path);
      } else {
        toast.error(result.error || 'Erro ao navegar no diretório');
      }
    } catch (error) {
      console.error('Erro ao navegar:', error);
      toast.error('Erro ao navegar no diretório');
    }
  };

  const scanDirectoryForVideos = async (directoryPath: string) => {
    setScanningDirectory(true);
    try {
      const token = await getToken();
      const response = await fetch('/api/ftp/scan-directory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ftpConnection: ftpData,
          directoryPath
        })
      });

      const result = await response.json();

      if (result.success) {
        setDirectoryVideos(result.videos || []);
        setSelectedDirectoryPath(directoryPath);
        setShowDirectoryModal(true);
        
        if (result.videos.length === 0) {
          toast.info('Nenhum vídeo encontrado nesta pasta');
        } else {
          toast.success(`${result.videos.length} vídeo(s) encontrado(s) na pasta`);
        }
      } else {
        toast.error(result.error || 'Erro ao escanear diretório');
      }
    } catch (error) {
      console.error('Erro ao escanear diretório:', error);
      toast.error('Erro ao escanear diretório');
    } finally {
      setScanningDirectory(false);
    }
  };

  const toggleFileSelection = (filePath: string) => {
    setSelectedFiles(prev => {
      if (prev.includes(filePath)) {
        return prev.filter(f => f !== filePath);
      } else {
        return [...prev, filePath];
      }
    });
  };

  const selectAllVideos = () => {
    const videoFiles = ftpFiles.filter(f => f.type === 'file' && f.isVideo).map(f => f.path);
    setSelectedFiles(videoFiles);
  };

  const selectAllDirectoryVideos = () => {
    const videoPaths = directoryVideos.map(v => v.path);
    setSelectedFiles(videoPaths);
    setShowDirectoryModal(false);
  };

  const clearSelection = () => {
    setSelectedFiles([]);
  };

  const startMigration = async () => {
    if (selectedFiles.length === 0) {
      toast.error('Selecione pelo menos um arquivo para migrar');
      return;
    }

    if (!selectedFolder) {
      toast.error('Selecione uma pasta de destino');
      return;
    }

    setIsMigrating(true);
    setShowMigrationModal(true);
    
    // Inicializar progresso
    const initialProgress = selectedFiles.map(filePath => ({
      fileName: filePath.split('/').pop() || filePath,
      progress: 0,
      status: 'pending' as const
    }));
    setMigrationProgress(initialProgress);

    try {
      const token = await getToken();
      
      // Simular progresso durante o download
      const progressInterval = setInterval(() => {
        setMigrationProgress(prev => prev.map(item => {
          if (item.status === 'pending') {
            return { ...item, status: 'downloading', progress: Math.min(item.progress + 10, 90) };
          }
          return item;
        }));
      }, 1000);

      const response = await fetch('/api/ftp/migrate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ftpConnection: ftpData,
          files: selectedFiles,
          destinationFolder: selectedFolder
        })
      });

      clearInterval(progressInterval);

      const result = await response.json();

      if (result.success) {
        toast.success(`${result.migratedFiles} de ${result.totalFiles} arquivo(s) migrado(s) com sucesso!`);
        setSelectedFiles([]);
        
        // Atualizar progresso final
        setMigrationProgress(prev => prev.map(item => ({
          ...item,
          progress: 100,
          status: 'completed'
        })));

        if (result.errors && result.errors.length > 0) {
          console.warn('Erros durante a migração:', result.errors);
        }
      } else {
        toast.error(result.error || 'Erro durante a migração');
        
        // Marcar como erro
        setMigrationProgress(prev => prev.map(item => ({
          ...item,
          status: 'error',
          error: result.error
        })));
      }
    } catch (error) {
      console.error('Erro na migração:', error);
      toast.error('Erro durante a migração');
      
      setMigrationProgress(prev => prev.map(item => ({
        ...item,
        status: 'error',
        error: 'Erro de conexão'
      })));
    } finally {
      setIsMigrating(false);
    }
  };

  const disconnect = () => {
    setIsConnected(false);
    setFtpFiles([]);
    setCurrentPath('/');
    setSelectedFiles([]);
    setDirectoryVideos([]);
    setShowDirectoryModal(false);
    setFtpData({
      ip: '',
      usuario: '',
      senha: '',
      porta: 21
    });
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

  const getFileIcon = (file: FTPFile) => {
    if (file.type === 'directory') {
      return <Folder className="h-5 w-5 text-blue-600" />;
    } else if (file.isVideo) {
      return <Video className="h-5 w-5 text-green-600" />;
    } else {
      return <div className="h-5 w-5 bg-gray-400 rounded"></div>;
    }
  };

  const goToParentDirectory = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateToDirectory(parentPath);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center mb-6">
        <Link to="/dashboard" className="flex items-center text-primary-600 hover:text-primary-800">
          <ChevronLeft className="h-5 w-5 mr-1" />
          <span>Voltar ao Dashboard</span>
        </Link>
      </div>

      <div className="flex items-center space-x-3">
        <Server className="h-8 w-8 text-primary-600" />
        <h1 className="text-3xl font-bold text-gray-900">Migrar Vídeos via FTP</h1>
      </div>

      {/* Informações de ajuda */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start">
          <AlertCircle className="h-5 w-5 text-blue-600 mr-3 mt-0.5" />
          <div>
            <h3 className="text-blue-900 font-medium mb-2">Como usar esta ferramenta</h3>
            <ul className="text-blue-800 text-sm space-y-1">
              <li>• Preencha os dados de conexão FTP do servidor remoto</li>
              <li>• Conecte-se e navegue pelos diretórios para encontrar os vídeos</li>
              <li>• <strong>NOVO:</strong> Clique no ícone de pasta para escanear recursivamente e encontrar todos os vídeos</li>
              <li>• Selecione os arquivos de vídeo que deseja migrar</li>
              <li>• Escolha a pasta de destino no seu sistema</li>
              <li>• Inicie a migração e acompanhe o progresso</li>
            </ul>
          </div>
        </div>
      </div>

      {!isConnected ? (
        /* Formulário de conexão FTP */
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Dados de Conexão FTP</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="ip" className="block text-sm font-medium text-gray-700 mb-2">
                IP/Servidor *
              </label>
              <input
                id="ip"
                type="text"
                value={ftpData.ip}
                onChange={(e) => handleInputChange('ip', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                placeholder="192.168.1.100 ou ftp.exemplo.com"
                disabled={isConnecting}
              />
            </div>

            <div>
              <label htmlFor="porta" className="block text-sm font-medium text-gray-700 mb-2">
                Porta
              </label>
              <input
                id="porta"
                type="number"
                value={ftpData.porta}
                onChange={(e) => handleInputChange('porta', parseInt(e.target.value) || 21)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                placeholder="21"
                disabled={isConnecting}
              />
            </div>

            <div>
              <label htmlFor="usuario" className="block text-sm font-medium text-gray-700 mb-2">
                Usuário *
              </label>
              <input
                id="usuario"
                type="text"
                value={ftpData.usuario}
                onChange={(e) => handleInputChange('usuario', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                placeholder="Nome de usuário FTP"
                disabled={isConnecting}
              />
            </div>

            <div>
              <label htmlFor="senha" className="block text-sm font-medium text-gray-700 mb-2">
                Senha *
              </label>
              <div className="relative">
                <input
                  id="senha"
                  type={showPassword ? 'text' : 'password'}
                  value={ftpData.senha}
                  onChange={(e) => handleInputChange('senha', e.target.value)}
                  className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Senha do FTP"
                  disabled={isConnecting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  disabled={isConnecting}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={connectToFTP}
              disabled={isConnecting || !ftpData.ip || !ftpData.usuario || !ftpData.senha}
              className="bg-primary-600 text-white px-6 py-2 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              <Server className="h-4 w-4 mr-2" />
              {isConnecting ? 'Conectando...' : 'Conectar ao FTP'}
            </button>
          </div>
        </div>
      ) : (
        /* Interface de navegação e seleção de arquivos */
        <div className="space-y-6">
          {/* Status da conexão */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
                <span className="text-green-800 font-medium">
                  Conectado ao FTP: {ftpData.usuario}@{ftpData.ip}
                </span>
              </div>
              <button
                onClick={disconnect}
                className="text-red-600 hover:text-red-800 text-sm"
              >
                Desconectar
              </button>
            </div>
          </div>

          {/* Navegação e controles */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-600">Caminho atual:</span>
                <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                  {currentPath}
                </span>
                {currentPath !== '/' && (
                  <button
                    onClick={goToParentDirectory}
                    className="text-primary-600 hover:text-primary-800 text-sm"
                  >
                    ← Voltar
                  </button>
                )}
              </div>
              
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">
                  {selectedFiles.length} arquivo(s) selecionado(s)
                </span>
                {selectedFiles.length > 0 && (
                  <button
                    onClick={clearSelection}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Limpar seleção
                  </button>
                )}
                <button
                  onClick={selectAllVideos}
                  className="text-primary-600 hover:text-primary-800 text-sm"
                >
                  Selecionar todos os vídeos
                </button>
              </div>
            </div>

            {/* Lista de arquivos */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                <div className="grid grid-cols-12 gap-4 text-sm font-medium text-gray-700">
                  <div className="col-span-1">Sel.</div>
                  <div className="col-span-1">Tipo</div>
                  <div className="col-span-6">Nome</div>
                  <div className="col-span-2">Tamanho</div>
                  <div className="col-span-2">Ações</div>
                </div>
              </div>
              
              <div className="max-h-96 overflow-y-auto">
                {ftpFiles.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    Nenhum arquivo encontrado neste diretório
                  </div>
                ) : (
                  ftpFiles.map((file, index) => (
                    <div
                      key={index}
                      className={`px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${
                        selectedFiles.includes(file.path) ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="grid grid-cols-12 gap-4 items-center text-sm">
                        <div className="col-span-1">
                          {file.type === 'file' && file.isVideo && (
                            <input
                              type="checkbox"
                              checked={selectedFiles.includes(file.path)}
                              onChange={() => toggleFileSelection(file.path)}
                              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                            />
                          )}
                        </div>
                        
                        <div className="col-span-1">
                          {getFileIcon(file)}
                        </div>
                        
                        <div className="col-span-6">
                          <span className={`${file.isVideo ? 'text-green-700 font-medium' : 'text-gray-700'}`}>
                            {file.name}
                          </span>
                          {file.isVideo && (
                            <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                              VÍDEO
                            </span>
                          )}
                        </div>
                        
                        <div className="col-span-2 text-gray-600">
                          {file.type === 'file' ? formatFileSize(file.size) : '-'}
                        </div>
                        
                        <div className="col-span-2 flex items-center space-x-2">
                          {file.type === 'directory' && (
                            <>
                              <button
                                onClick={() => navigateToDirectory(file.path)}
                                className="text-primary-600 hover:text-primary-800 text-sm"
                                title="Abrir pasta"
                              >
                                Abrir
                              </button>
                              <button
                                onClick={() => scanDirectoryForVideos(file.path)}
                                disabled={scanningDirectory}
                                className="text-green-600 hover:text-green-800 text-sm disabled:opacity-50"
                                title="Escanear pasta recursivamente"
                              >
                                <FolderOpen className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Seleção de pasta de destino e migração */}
          {selectedFiles.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Migrar Arquivos Selecionados</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="pasta-destino" className="block text-sm font-medium text-gray-700 mb-2">
                    Pasta de Destino *
                  </label>
                  <select
                    id="pasta-destino"
                    value={selectedFolder}
                    onChange={(e) => setSelectedFolder(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">Selecione uma pasta</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.nome}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="flex items-end">
                  <button
                    onClick={startMigration}
                    disabled={isMigrating || !selectedFolder}
                    className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    {isMigrating ? 'Migrando...' : `Migrar ${selectedFiles.length} arquivo(s)`}
                  </button>
                </div>
              </div>
              
              <div className="mt-4 p-3 bg-gray-50 rounded-md">
                <p className="text-sm text-gray-600">
                  <strong>Arquivos selecionados:</strong>
                </p>
                <ul className="mt-2 text-sm text-gray-700 max-h-32 overflow-y-auto">
                  {selectedFiles.map((filePath, index) => (
                    <li key={index} className="flex items-center justify-between py-1">
                      <span>{filePath.split('/').pop()}</span>
                      <button
                        onClick={() => toggleFileSelection(filePath)}
                        className="text-red-600 hover:text-red-800 ml-2"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal de vídeos encontrados na pasta */}
      {showDirectoryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">
                  Vídeos encontrados em: {selectedDirectoryPath}
                </h3>
                <button
                  onClick={() => setShowDirectoryModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
              <p className="text-sm text-gray-600 mt-2">
                {directoryVideos.length} vídeo(s) encontrado(s) recursivamente
              </p>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {directoryVideos.length === 0 ? (
                <p className="text-gray-500 text-center py-8">Nenhum vídeo encontrado nesta pasta</p>
              ) : (
                <div className="space-y-2">
                  {directoryVideos.map((video, index) => (
                    <div key={index} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{video.name}</div>
                        <div className="text-sm text-gray-500">{video.directory}</div>
                        <div className="text-xs text-gray-400">{formatFileSize(video.size)}</div>
                      </div>
                      <Video className="h-5 w-5 text-green-600" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {directoryVideos.length > 0 && (
              <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
                <button
                  onClick={() => setShowDirectoryModal(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                >
                  Cancelar
                </button>
                <button
                  onClick={selectAllDirectoryVideos}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  Selecionar Todos ({directoryVideos.length})
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de progresso da migração */}
      {showMigrationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Progresso da Migração</h3>
                {!isMigrating && (
                  <button
                    onClick={() => setShowMigrationModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="space-y-4">
                {migrationProgress.map((item, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-900">{item.fileName}</span>
                      <span className={`text-sm px-2 py-1 rounded ${
                        item.status === 'completed' ? 'bg-green-100 text-green-800' :
                        item.status === 'error' ? 'bg-red-100 text-red-800' :
                        item.status === 'downloading' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {item.status === 'completed' ? 'Concluído' :
                         item.status === 'error' ? 'Erro' :
                         item.status === 'downloading' ? 'Baixando' :
                         'Aguardando'}
                      </span>
                    </div>
                    
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${
                          item.status === 'completed' ? 'bg-green-600' :
                          item.status === 'error' ? 'bg-red-600' :
                          'bg-blue-600'
                        }`}
                        style={{ width: `${item.progress}%` }}
                      ></div>
                    </div>
                    
                    {item.error && (
                      <p className="text-red-600 text-sm mt-2">{item.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MigrarVideosFTP;