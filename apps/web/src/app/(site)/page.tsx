import type { Metadata } from 'next';
import { priceFor } from '@medicore/shared-types';
import { Landing } from '@/components/landing';
import { FAQ, PLANS } from '@/components/landing-data';
import { PARENT_NAME, PARENT_URL, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  keywords: ['MediCore', 'MediCore by Godevs', 'teamgodevs', 'Godevs MediCore', 'pharmacy software India', 'pharmacy ERP', 'GST billing software for pharmacy', 'medical store software', 'batch and expiry management', 'Schedule H1 register software'],
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: { title: SITE_TITLE, description: SITE_DESCRIPTION, url: '/', type: 'website' },
  twitter: { title: SITE_TITLE, description: SITE_DESCRIPTION },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: PARENT_NAME,
      alternateName: ['Team Godevs', 'TeamGodevs'],
      url: PARENT_URL,
      sameAs: ['https://github.com/Godevs04'],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      alternateName: 'MediCore by Godevs',
      inLanguage: 'en-IN',
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/#software`,
      name: SITE_NAME,
      alternateName: ['MediCore by Godevs', 'MediCore Pharmacy ERP'],
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      sameAs: ['https://github.com/Godevs04/MedStore'],
      author: { '@id': `${SITE_URL}/#organization` },
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'en-IN',
      publisher: { '@id': `${SITE_URL}/#organization` },
      offers: PLANS.filter((p) => p.key).map((p) => ({
        '@type': 'Offer',
        name: p.name,
        description: p.audience,
        price: (priceFor(p.key!, 'MONTHLY').basePaise / 100).toFixed(2),
        priceCurrency: 'INR',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: (priceFor(p.key!, 'MONTHLY').basePaise / 100).toFixed(2),
          priceCurrency: 'INR',
          billingDuration: 'P1M',
          valueAddedTaxIncluded: false,
        },
        url: `${SITE_URL}/#pricing`,
        availability: 'https://schema.org/InStock',
      })),
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  ],
};

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <Landing />
    </>
  );
}
