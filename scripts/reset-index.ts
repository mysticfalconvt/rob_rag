import './setup-env';
import prisma from '../lib/prisma';
import { scanAllFiles } from '../lib/indexer';

async function resetIndex() {
    console.log('⚠️  Resetting index database...');

    // Delete all records from IndexedFile table
    await prisma.indexedFile.deleteMany({});
    console.log('✅ Cleared IndexedFile table.');

    console.log('Running full re-scan...');
    await scanAllFiles();
}

resetIndex()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
