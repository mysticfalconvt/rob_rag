import './setup-env';
import { indexFile } from '../lib/indexer';
import { search } from '../lib/retrieval';
import path from 'path';

async function testIndexing() {
    console.log('Testing end-to-end indexing...\n');

    const testFile = path.join(process.cwd(), 'documents', 'test.md');

    try {
        console.log('1. Indexing test.md...');
        await indexFile(testFile);
        console.log('✓ File indexed successfully\n');

        console.log('2. Searching for "RAG system"...');
        const results = await search('RAG system', 3);
        console.log(`✓ Found ${results.length} results:\n`);

        results.forEach((result, i) => {
            console.log(`Result ${i + 1} (score: ${result.score.toFixed(4)}):`);
            console.log(result.content.substring(0, 100) + '...\n');
        });

        console.log('✓ All tests passed!');
    } catch (error) {
        console.error('✗ Test failed:', error);
        process.exit(1);
    }
}

testIndexing();
