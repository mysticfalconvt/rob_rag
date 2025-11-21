import chokidar from 'chokidar';
import path from 'path';
import { config } from '../lib/config';
import { indexFile, deleteFileIndex } from '../lib/indexer';

const watcher = chokidar.watch(config.DOCUMENTS_FOLDER_PATH, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: false, // Index existing files on startup
    awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
    },
});

console.log(`Watching for file changes in ${config.DOCUMENTS_FOLDER_PATH}...`);

watcher
    .on('add', async (filePath) => {
        console.log(`File added: ${filePath}`);
        try {
            await indexFile(filePath);
        } catch (error) {
            console.error(`Failed to index ${filePath}:`, error);
        }
    })
    .on('change', async (filePath) => {
        console.log(`File changed: ${filePath}`);
        try {
            await indexFile(filePath);
        } catch (error) {
            console.error(`Failed to re-index ${filePath}:`, error);
        }
    })
    .on('unlink', async (filePath) => {
        console.log(`File removed: ${filePath}`);
        try {
            await deleteFileIndex(filePath);
        } catch (error) {
            console.error(`Failed to remove index for ${filePath}:`, error);
        }
    })
    .on('error', (error) => console.error(`Watcher error: ${error}`));
