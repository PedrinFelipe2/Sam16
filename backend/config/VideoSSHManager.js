const SSHManager = require('./SSHManager');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

class VideoSSHManager {
    constructor() {
        this.tempDir = '/tmp/video-cache';
        this.maxCacheSize = 2 * 1024 * 1024 * 1024; // 2GB
        this.cacheCleanupInterval = 30 * 60 * 1000; // 30 minutos
        this.downloadQueue = new Map();
        
        this.initializeTempDir();
        this.startCleanupTimer();
    }

    async initializeTempDir() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
            console.log(`📁 Diretório temporário criado: ${this.tempDir}`);
        } catch (error) {
            console.error('Erro ao criar diretório temporário:', error);
        }
    }

    startCleanupTimer() {
        setInterval(() => {
            this.cleanupOldFiles();
        }, this.cacheCleanupInterval);
    }

    async cleanupOldFiles() {
        try {
            const files = await fs.readdir(this.tempDir);
            const now = Date.now();
            const maxAge = 60 * 60 * 1000; // 1 hora

            for (const file of files) {
                const filePath = path.join(this.tempDir, file);
                const stats = await fs.stat(filePath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    await fs.unlink(filePath);
                    console.log(`🗑️ Arquivo temporário removido: ${file}`);
                }
            }
        } catch (error) {
            console.error('Erro na limpeza de arquivos temporários:', error);
        }
    }

    async listVideosFromServer(serverId, userLogin, folderName = null) {
        try {
            const basePath = `/usr/local/WowzaStreamingEngine/content/${userLogin}`;
            const searchPath = folderName ? `${basePath}/${folderName}` : basePath;
            
            // Comando para listar apenas arquivos de vídeo recursivamente
            const command = `find "${searchPath}" -type f \\( -iname "*.mp4" -o -iname "*.avi" -o -iname "*.mov" -o -iname "*.wmv" -o -iname "*.flv" -o -iname "*.webm" -o -iname "*.mkv" \\) -exec ls -la {} \\; 2>/dev/null || echo "NO_VIDEOS"`;
            
            const result = await SSHManager.executeCommand(serverId, command);
            
            if (result.stdout.includes('NO_VIDEOS')) {
                return [];
            }

            const videos = [];
            const lines = result.stdout.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
                if (line.includes('total ') || !line.trim()) continue;
                
                const parts = line.trim().split(/\s+/);
                if (parts.length < 9) continue;
                
                const permissions = parts[0];
                const size = parseInt(parts[4]) || 0;
                const fullPath = parts.slice(8).join(' ');
                const fileName = path.basename(fullPath);
                const relativePath = fullPath.replace(`/usr/local/WowzaStreamingEngine/content/${userLogin}/`, '');
                const folderPath = path.dirname(relativePath);
                
                // Extrair duração do vídeo (se possível via ffprobe)
                let duration = 0;
                try {
                    const durationCommand = `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${fullPath}" 2>/dev/null || echo "0"`;
                    const durationResult = await SSHManager.executeCommand(serverId, durationCommand);
                    duration = Math.floor(parseFloat(durationResult.stdout.trim()) || 0);
                } catch (error) {
                    console.warn(`Não foi possível obter duração de ${fileName}`);
                }

                videos.push({
                    id: Buffer.from(fullPath).toString('base64'), // ID único baseado no caminho
                    nome: fileName,
                    path: relativePath,
                    fullPath: fullPath,
                    folder: folderPath === '.' ? 'root' : folderPath,
                    size: size,
                    duration: duration,
                    permissions: permissions,
                    lastModified: new Date().toISOString(), // Seria melhor extrair do ls
                    serverId: serverId,
                    userLogin: userLogin
                });
            }

            console.log(`📹 Encontrados ${videos.length} vídeos no servidor para ${userLogin}`);
            return videos;
            
        } catch (error) {
            console.error('Erro ao listar vídeos do servidor:', error);
            return [];
        }
    }

    async downloadVideoToTemp(serverId, remotePath, videoId) {
        try {
            // Verificar se já está sendo baixado
            if (this.downloadQueue.has(videoId)) {
                return this.downloadQueue.get(videoId);
            }

            const fileName = path.basename(remotePath);
            const localPath = path.join(this.tempDir, `${videoId}_${fileName}`);
            
            // Verificar se arquivo já existe localmente
            try {
                const stats = await fs.stat(localPath);
                const age = Date.now() - stats.mtime.getTime();
                
                // Se arquivo tem menos de 1 hora, usar o cache
                if (age < 60 * 60 * 1000) {
                    console.log(`📦 Usando vídeo em cache: ${fileName}`);
                    return {
                        success: true,
                        localPath: localPath,
                        cached: true
                    };
                }
            } catch (error) {
                // Arquivo não existe, continuar com download
            }

            console.log(`⬇️ Iniciando download de ${fileName} via SSH...`);

            // Criar promise para o download
            const downloadPromise = new Promise(async (resolve, reject) => {
                try {
                    const { conn } = await SSHManager.getConnection(serverId);
                    
                    conn.sftp((err, sftp) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        const readStream = sftp.createReadStream(remotePath);
                        const writeStream = require('fs').createWriteStream(localPath);
                        
                        let downloadedBytes = 0;
                        
                        readStream.on('data', (chunk) => {
                            downloadedBytes += chunk.length;
                        });

                        readStream.on('error', (error) => {
                            console.error(`Erro no download de ${fileName}:`, error);
                            // Limpar arquivo parcial
                            fs.unlink(localPath).catch(() => {});
                            reject(error);
                        });

                        writeStream.on('error', (error) => {
                            console.error(`Erro ao escrever ${fileName}:`, error);
                            fs.unlink(localPath).catch(() => {});
                            reject(error);
                        });

                        writeStream.on('finish', () => {
                            console.log(`✅ Download concluído: ${fileName} (${downloadedBytes} bytes)`);
                            resolve({
                                success: true,
                                localPath: localPath,
                                downloadedBytes: downloadedBytes,
                                cached: false
                            });
                        });

                        readStream.pipe(writeStream);
                    });
                } catch (error) {
                    reject(error);
                }
            });

            // Adicionar à fila de downloads
            this.downloadQueue.set(videoId, downloadPromise);
            
            const result = await downloadPromise;
            
            // Remover da fila após conclusão
            this.downloadQueue.delete(videoId);
            
            return result;
            
        } catch (error) {
            console.error('Erro no download do vídeo:', error);
            this.downloadQueue.delete(videoId);
            throw error;
        }
    }

    async getVideoStream(serverId, remotePath, videoId) {
        try {
            // Primeiro, tentar download para cache local
            const downloadResult = await this.downloadVideoToTemp(serverId, remotePath, videoId);
            
            if (downloadResult.success) {
                return {
                    success: true,
                    type: 'local',
                    path: downloadResult.localPath,
                    cached: downloadResult.cached
                };
            }
            
            throw new Error('Falha no download do vídeo');
            
        } catch (error) {
            console.error('Erro ao obter stream do vídeo:', error);
            
            // Fallback: tentar streaming direto via SSH (mais complexo)
            try {
                return await this.createSSHVideoStream(serverId, remotePath);
            } catch (streamError) {
                console.error('Erro no streaming direto:', streamError);
                throw new Error('Não foi possível acessar o vídeo');
            }
        }
    }

    async createSSHVideoStream(serverId, remotePath) {
        // Esta função criaria um stream direto via SSH
        // Por enquanto, retornar erro para forçar o download
        throw new Error('Streaming direto não implementado');
    }

    async getVideoInfo(serverId, remotePath) {
        try {
            // Obter informações detalhadas do vídeo via SSH
            const commands = [
                `ls -la "${remotePath}"`,
                `ffprobe -v quiet -print_format json -show_format -show_streams "${remotePath}" 2>/dev/null || echo "NO_FFPROBE"`
            ];

            const results = await Promise.all(
                commands.map(cmd => SSHManager.executeCommand(serverId, cmd))
            );

            const lsResult = results[0];
            const ffprobeResult = results[1];

            // Parsear informações básicas do ls
            const lsParts = lsResult.stdout.trim().split(/\s+/);
            const size = parseInt(lsParts[4]) || 0;
            const fileName = path.basename(remotePath);

            let videoInfo = {
                name: fileName,
                size: size,
                duration: 0,
                width: 0,
                height: 0,
                bitrate: 0,
                codec: 'unknown',
                format: path.extname(fileName).toLowerCase().substring(1)
            };

            // Parsear informações do ffprobe se disponível
            if (!ffprobeResult.stdout.includes('NO_FFPROBE')) {
                try {
                    const ffprobeData = JSON.parse(ffprobeResult.stdout);
                    
                    if (ffprobeData.format) {
                        videoInfo.duration = Math.floor(parseFloat(ffprobeData.format.duration) || 0);
                        videoInfo.bitrate = Math.floor(parseInt(ffprobeData.format.bit_rate) / 1000) || 0;
                    }

                    if (ffprobeData.streams) {
                        const videoStream = ffprobeData.streams.find(s => s.codec_type === 'video');
                        if (videoStream) {
                            videoInfo.width = videoStream.width || 0;
                            videoInfo.height = videoStream.height || 0;
                            videoInfo.codec = videoStream.codec_name || 'unknown';
                        }
                    }
                } catch (parseError) {
                    console.warn('Erro ao parsear dados do ffprobe:', parseError);
                }
            }

            return videoInfo;
            
        } catch (error) {
            console.error('Erro ao obter informações do vídeo:', error);
            return null;
        }
    }

    async deleteVideoFromServer(serverId, remotePath) {
        try {
            await SSHManager.deleteFile(serverId, remotePath);
            
            // Também remover do cache local se existir
            const videoId = Buffer.from(remotePath).toString('base64');
            const fileName = path.basename(remotePath);
            const localPath = path.join(this.tempDir, `${videoId}_${fileName}`);
            
            try {
                await fs.unlink(localPath);
                console.log(`🗑️ Arquivo removido do cache: ${fileName}`);
            } catch (error) {
                // Arquivo não estava em cache, ignorar
            }
            
            return { success: true };
        } catch (error) {
            console.error('Erro ao deletar vídeo do servidor:', error);
            throw error;
        }
    }

    async getCacheStatus() {
        try {
            const files = await fs.readdir(this.tempDir);
            let totalSize = 0;
            const fileDetails = [];

            for (const file of files) {
                const filePath = path.join(this.tempDir, file);
                const stats = await fs.stat(filePath);
                totalSize += stats.size;
                
                fileDetails.push({
                    name: file,
                    size: stats.size,
                    lastAccessed: stats.atime,
                    age: Date.now() - stats.mtime.getTime()
                });
            }

            return {
                totalFiles: files.length,
                totalSize: totalSize,
                maxSize: this.maxCacheSize,
                usagePercentage: (totalSize / this.maxCacheSize) * 100,
                files: fileDetails
            };
        } catch (error) {
            console.error('Erro ao obter status do cache:', error);
            return {
                totalFiles: 0,
                totalSize: 0,
                maxSize: this.maxCacheSize,
                usagePercentage: 0,
                files: []
            };
        }
    }

    async clearCache() {
        try {
            const files = await fs.readdir(this.tempDir);
            
            for (const file of files) {
                const filePath = path.join(this.tempDir, file);
                await fs.unlink(filePath);
            }
            
            console.log(`🧹 Cache limpo: ${files.length} arquivos removidos`);
            return { success: true, removedFiles: files.length };
        } catch (error) {
            console.error('Erro ao limpar cache:', error);
            throw error;
        }
    }

    // Método para verificar se um vídeo está disponível para streaming
    async checkVideoAvailability(serverId, remotePath) {
        try {
            const fileInfo = await SSHManager.getFileInfo(serverId, remotePath);
            
            if (!fileInfo.exists) {
                return {
                    available: false,
                    reason: 'Arquivo não encontrado no servidor'
                };
            }

            // Verificar se é um arquivo de vídeo válido
            const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv'];
            const extension = path.extname(remotePath).toLowerCase();
            
            if (!videoExtensions.includes(extension)) {
                return {
                    available: false,
                    reason: 'Formato de arquivo não suportado'
                };
            }

            // Verificar se arquivo não está corrompido (tamanho > 0)
            if (fileInfo.size === 0) {
                return {
                    available: false,
                    reason: 'Arquivo vazio ou corrompido'
                };
            }

            return {
                available: true,
                size: fileInfo.size,
                info: fileInfo
            };
            
        } catch (error) {
            console.error('Erro ao verificar disponibilidade do vídeo:', error);
            return {
                available: false,
                reason: 'Erro ao acessar servidor'
            };
        }
    }

    // Método para obter thumbnail do vídeo
    async generateVideoThumbnail(serverId, remotePath, videoId) {
        try {
            const thumbnailName = `${videoId}_thumb.jpg`;
            const localThumbnailPath = path.join(this.tempDir, thumbnailName);
            
            // Verificar se thumbnail já existe
            try {
                await fs.access(localThumbnailPath);
                return {
                    success: true,
                    thumbnailPath: localThumbnailPath,
                    cached: true
                };
            } catch (error) {
                // Thumbnail não existe, gerar
            }

            // Gerar thumbnail via SSH usando ffmpeg
            const tempRemoteThumbnail = `/tmp/${thumbnailName}`;
            const ffmpegCommand = `ffmpeg -i "${remotePath}" -ss 00:00:10 -vframes 1 -q:v 2 -s 320x180 "${tempRemoteThumbnail}" -y 2>/dev/null && echo "THUMB_OK" || echo "THUMB_ERROR"`;
            
            const result = await SSHManager.executeCommand(serverId, ffmpegCommand);
            
            if (result.stdout.includes('THUMB_OK')) {
                // Baixar thumbnail para local
                await SSHManager.uploadFile(serverId, tempRemoteThumbnail, localThumbnailPath);
                
                // Limpar thumbnail temporário do servidor
                await SSHManager.executeCommand(serverId, `rm -f "${tempRemoteThumbnail}"`);
                
                return {
                    success: true,
                    thumbnailPath: localThumbnailPath,
                    cached: false
                };
            } else {
                throw new Error('Falha ao gerar thumbnail');
            }
            
        } catch (error) {
            console.error('Erro ao gerar thumbnail:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    formatFileSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // Método para verificar integridade de vídeos
    async checkVideoIntegrity(serverId, remotePath) {
        try {
            // Verificar se arquivo existe e não está corrompido
            const ffprobeCommand = `ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "${remotePath}" 2>/dev/null || echo "ERROR"`;
            const result = await SSHManager.executeCommand(serverId, ffprobeCommand);
            
            if (result.stdout.includes('ERROR') || result.stdout.trim() === '0') {
                return {
                    valid: false,
                    reason: 'Arquivo corrompido ou não é um vídeo válido'
                };
            }
            
            return {
                valid: true,
                packets: parseInt(result.stdout.trim()) || 0
            };
        } catch (error) {
            return {
                valid: false,
                reason: 'Erro ao verificar integridade'
            };
        }
    }

    // Método para obter URL de streaming otimizada
    async getOptimizedStreamUrl(serverId, remotePath, userLogin) {
        try {
            const fileName = path.basename(remotePath);
            const folderPath = path.dirname(remotePath).split('/').pop();
            
            // Construir URLs baseadas no ambiente
            const isProduction = process.env.NODE_ENV === 'production';
            const wowzaHost = isProduction ? 'samhost.wcore.com.br' : '51.222.156.223';
            
            // URL direta do Wowza (porta 6980 para VOD)
            const directUrl = `http://${wowzaHost}:6980/content/${userLogin}/${folderPath}/${fileName}`;
            
            // URL HLS se disponível
            const hlsUrl = `http://${wowzaHost}:1935/vod/${userLogin}/${folderPath}/${fileName}/playlist.m3u8`;
            
            // URL via proxy do backend
            const proxyUrl = `/content/${userLogin}/${folderPath}/${fileName}`;
            
            return {
                direct: directUrl,
                hls: hlsUrl,
                proxy: proxyUrl,
                ssh: `/api/videos-ssh/stream/${Buffer.from(remotePath).toString('base64')}`
            };
        } catch (error) {
            console.error('Erro ao gerar URLs:', error);
            return null;
        }
    }

    // Método para limpar arquivos órfãos
    async cleanupOrphanedFiles(serverId, userLogin) {
        try {
            const userPath = `/usr/local/WowzaStreamingEngine/content/${userLogin}`;
            
            // Encontrar arquivos temporários ou corrompidos
            const cleanupCommand = `find "${userPath}" -type f \\( -name "*.tmp" -o -name "*.part" -o -size 0 \\) -delete 2>/dev/null || true`;
            await SSHManager.executeCommand(serverId, cleanupCommand);
            
            // Remover diretórios vazios
            const removeDirsCommand = `find "${userPath}" -type d -empty -delete 2>/dev/null || true`;
            await SSHManager.executeCommand(serverId, removeDirsCommand);
            
            console.log(`🧹 Limpeza concluída para usuário ${userLogin}`);
            return { success: true };
        } catch (error) {
            console.error('Erro na limpeza:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new VideoSSHManager();