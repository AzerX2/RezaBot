import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Document } from '@langchain/core/documents';
import { ragService } from '../src/services/ragService.js';

/**
 * Script autonome d'ingestion de données (FAQ, règles, documentation)
 * vers la base vectorielle ChromaDB via LangChain.
 */
async function runIngestion() {
  console.log('='.repeat(65));
  console.log('🚀 [REZABOT - RAG] Démarrage du script d\'ingestion ChromaDB');
  console.log('='.repeat(65));

  const faqFilePath = path.resolve('data/faq.json');

  // 1. Vérification de l'existence du fichier data/faq.json
  if (!fs.existsSync(faqFilePath)) {
    console.error(`❌ [ERREUR] Le fichier de données est introuvable : ${faqFilePath}`);
    console.error('Assurez-vous que le fichier data/faq.json existe avant de lancer l\'ingestion.');
    process.exit(1);
  }

  // 2. Lecture et parsing du JSON
  let rawData;
  try {
    const fileContent = fs.readFileSync(faqFilePath, 'utf-8');
    rawData = JSON.parse(fileContent);
    if (!Array.isArray(rawData)) {
      throw new Error("Le fichier data/faq.json doit contenir un tableau JSON d'objets.");
    }
  } catch (parseError) {
    console.error(`❌ [ERREUR] Impossible de lire ou de parser data/faq.json :`, parseError.message);
    process.exit(1);
  }

  console.log(`📄 [DATA] ${rawData.length} entrées trouvées dans data/faq.json.`);

  // 3. Transformation en objets Document de LangChain
  const documents = rawData.map((item, index) => {
    const content = `Catégorie: ${item.category}\nTitre: ${item.title}\nDétails: ${item.content}`;
    
    return new Document({
      pageContent: content,
      metadata: {
        id: item.id || `doc-${index + 1}`,
        category: item.category || 'Général',
        title: item.title || 'Sans titre',
        tags: Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || '')
      }
    });
  });

  console.log(`🔄 [TRANSFORM] ${documents.length} document(s) LangChain préparé(s) pour la vectorisation.`);

  // Récupération de la guilde cible (argument CLI ou .env)
  const targetGuildId = process.argv[2] || process.env.DISCORD_GUILD_ID || 'default_guild';
  console.log(`🏰 [MULTI-TENANCY] Cible : Guild ID '${targetGuildId}'`);

  // 4. Ingestion dans ChromaDB via ragService
  try {
    console.log(`⏳ [VECTOR-DB] Génération des embeddings et insertion dans ChromaDB...`);
    const result = await ragService.ingestDocuments(documents, targetGuildId);

    console.log('='.repeat(65));
    console.log(`✅ [SUCCÈS] Ingestion terminée avec succès !`);
    console.log(`📊 [RÉSUMÉ] ${result.count} documents sont désormais indexés pour la guilde '${targetGuildId}'.`);
    console.log(`🧠 [MÉMOIRE] Le concierge RezaBot peut désormais exploiter ce contexte pour cette guilde.`);
    console.log('='.repeat(65));

    // Clôture propre du processus
    process.exit(0);
  } catch (error) {
    console.error('='.repeat(65));
    console.error(`❌ [ÉCHEC] Erreur critique lors de l'ingestion dans ChromaDB :`, error.message);
    console.error(`💡 [CONSEIL] Vérifiez que :`);
    console.error(`   1. Votre serveur ChromaDB est actif (ex: docker run -p 8000:8000 chromadb/chroma)`);
    console.error(`   2. Votre clé OPENAI_API_KEY dans le fichier .env est valide (nécessaire pour les embeddings)`);
    console.error(`   3. L'URL Chroma dans .env (CHROMA_URL) pointe vers le bon hôte`);
    console.error('='.repeat(65));

    process.exit(1);
  }
}

// Exécution du script
runIngestion();
