import { CampaignType } from '../types';

export interface GenerateDraftRequest {
  campaignType: CampaignType;
  targetAudience: string;
  focusContext: string;
  featuredPropertyTitle?: string;
  featuredPropertyPrice?: number;
  featuredCityState?: string;
  tone: 'Professional & Authoritative' | 'Concise & High-Touch' | 'Investor-Focused' | 'Neighborly & Warm';
  includeComplianceFooter: boolean;
}

export function generateAICampaignDraft(request: GenerateDraftRequest): {
  title: string;
  subject: string;
  bodyContent: string;
} {
  const context = request.focusContext.trim();
  if (!context && !request.featuredPropertyTitle) {
    throw new Error('Add source-based context or select a real property before drafting.');
  }

  const title = `${request.campaignType} Draft`;
  const propertyDetails = request.featuredPropertyTitle
    ? [
        request.featuredPropertyTitle,
        request.featuredCityState,
        request.featuredPropertyPrice ? `$${request.featuredPropertyPrice.toLocaleString()}` : undefined
      ].filter(Boolean).join(' | ')
    : '';

  let bodyContent = `Hello {{Lead.FirstName}},\n\n${context}`;
  if (propertyDetails) bodyContent += `\n\nProperty details: ${propertyDetails}`;
  bodyContent += '\n\nContact your real estate representative for more information.';
  if (request.includeComplianceFooter) {
    bodyContent += '\n\nEqual Housing Opportunity. Review all details with the source provider before distribution.';
  }

  return {
    title,
    subject: `${request.campaignType} update`,
    bodyContent
  };
}