/**
 * Post-Build Security Script
 * 
 * This script runs after the Plasmo build to remove localhost from
 * externally_connectable in production builds, fixing CHECK #9 security vulnerability.
 * 
 * It only runs for production builds (NODE_ENV === 'production').
 * Development builds keep localhost for local testing.
 */

const fs = require('fs')
const path = require('path')

// Path to the production manifest file
const manifestPath = path.join(__dirname, '..', 'build', 'chrome-mv3-prod', 'manifest.json')

// Check if this is a production build by checking if the production manifest exists
// Plasmo creates 'chrome-mv3-prod' directory for production builds
if (!fs.existsSync(manifestPath)) {
  // Check if we're in a dev build context (chrome-mv3-dev exists)
  const devManifestPath = path.join(__dirname, '..', 'build', 'chrome-mv3-dev', 'manifest.json')
  if (fs.existsSync(devManifestPath)) {
    console.log('🔵 secure-manifest.js: Skipping (development build detected)')
    console.log('   Development builds keep localhost for local testing.')
  } else {
    console.warn('⚠️  secure-manifest.js: Manifest file not found at:', manifestPath)
    console.warn('   This is normal if running outside of a build context.')
  }
  process.exit(0)
}

// If we get here, we have a production build
console.log('🔒 secure-manifest.js: Production build detected, securing manifest...')

try {
  // Read the manifest file
  console.log('🔒 secure-manifest.js: Reading production manifest...')
  const manifestContent = fs.readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(manifestContent)

  // Check if externally_connectable exists
  if (!manifest.externally_connectable || !manifest.externally_connectable.matches) {
    console.log('✅ secure-manifest.js: No externally_connectable.matches found, nothing to secure.')
    process.exit(0)
  }

  // Store original matches for logging
  const originalMatches = [...manifest.externally_connectable.matches]
  
  // Filter out localhost entries
  const securedMatches = manifest.externally_connectable.matches.filter(
    match => !match.includes('localhost')
  )

  // Check if any localhost entries were removed
  if (originalMatches.length === securedMatches.length) {
    console.log('✅ secure-manifest.js: No localhost entries found in manifest (already secure)')
    process.exit(0)
  }

  // Update the manifest
  manifest.externally_connectable.matches = securedMatches

  // Write the secured manifest back to disk
  const securedContent = JSON.stringify(manifest, null, 2)
  fs.writeFileSync(manifestPath, securedContent, 'utf8')

  // Log success
  console.log('✅ secure-manifest.js: Successfully secured production manifest')
  console.log('   Removed localhost entries from externally_connectable.matches')
  console.log('   Original matches:', originalMatches)
  console.log('   Secured matches:', securedMatches)
  console.log('   CHECK #9: ✅ SECURED - localhost removed from production build')

} catch (error) {
  console.error('❌ secure-manifest.js: Error securing manifest:', error.message)
  console.error('   Stack:', error.stack)
  process.exit(1)
}

