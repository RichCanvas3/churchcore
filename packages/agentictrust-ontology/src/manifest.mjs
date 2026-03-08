export const AGENTICTRUST_ONTOLOGY_GITHUB_DIR =
  'https://raw.githubusercontent.com/agentictrustlabs/agent-explorer/main/apps/ontology/ontology';

// Must include the full set “as-is” from the referenced directory.
export const AGENTICTRUST_TTL_FILES = [
  'analytics.ttl',
  'core.ttl',
  'descriptors.ttl',
  'discovery.ttl',
  'dns.ttl',
  'ens.ttl',
  'erc8004.ttl',
  'erc8092.ttl',
  'erc8122.ttl',
  'eth.ttl',
  'hol.ttl',
  'identifier.ttl',
  'identity.ttl',
  'nanda.ttl',
  'oasf.ttl',
  'trust.ttl',
  'usecase-professional-membership.ttl',
  'usecase-request-validation.ttl',
  'usecase-validator-collection.ttl',
];

export function agentictrustUrl(fileName) {
  return `${AGENTICTRUST_ONTOLOGY_GITHUB_DIR}/${encodeURIComponent(fileName)}`;
}

