
INSERT INTO public.vehicle_registry (team_id, vehicle_name, vehicle_type, managing_agency, description, url, status)
SELECT NULL, v.vehicle_name, v.vehicle_type, v.managing_agency, v.description, v.url, v.status
FROM (VALUES
  -- GSA GWACs & MACs
  ('Alliant 3', 'gwac', 'GSA', 'Unrestricted IT services GWAC; successor to Alliant 2.', 'https://www.gsa.gov/technology/technology-purchasing-programs/governmentwide-acquisition-contracts/alliant-3', 'upcoming'),
  ('Alliant', 'gwac', 'GSA', 'First-generation unrestricted IT services GWAC.', NULL, 'expired'),
  ('Alliant 2 Small Business', 'gwac', 'GSA', 'Small-business IT services GWAC (cancelled after protests).', NULL, 'expired'),
  ('OASIS (legacy)', 'gwac', 'GSA', 'Original OASIS unrestricted and SB pools for professional services.', NULL, 'expired'),
  ('OASIS+ Small Business', 'gwac', 'GSA', 'OASIS+ small-business pool for professional services.', 'https://www.gsa.gov/oasisplus', 'active'),
  ('OASIS+ 8(a)', 'gwac', 'GSA', 'OASIS+ 8(a) socioeconomic pool.', 'https://www.gsa.gov/oasisplus', 'upcoming'),
  ('OASIS+ WOSB', 'gwac', 'GSA', 'OASIS+ Women-Owned Small Business pool.', 'https://www.gsa.gov/oasisplus', 'upcoming'),
  ('OASIS+ HUBZone', 'gwac', 'GSA', 'OASIS+ HUBZone small-business pool.', 'https://www.gsa.gov/oasisplus', 'upcoming'),
  ('OASIS+ SDVOSB', 'gwac', 'GSA', 'OASIS+ Service-Disabled Veteran-Owned Small Business pool.', 'https://www.gsa.gov/oasisplus', 'upcoming'),
  ('Polaris Small Business Pool', 'gwac', 'GSA', 'Polaris IT services SB pool (delayed by protests).', 'https://www.gsa.gov/technology/technology-purchasing-programs/governmentwide-acquisition-contracts/polaris', 'upcoming'),
  ('Polaris WOSB Pool', 'gwac', 'GSA', 'Polaris IT services Women-Owned Small Business pool.', 'https://www.gsa.gov/technology/technology-purchasing-programs/governmentwide-acquisition-contracts/polaris', 'upcoming'),
  ('Polaris HUBZone Pool', 'gwac', 'GSA', 'Polaris IT services HUBZone pool.', 'https://www.gsa.gov/technology/technology-purchasing-programs/governmentwide-acquisition-contracts/polaris', 'upcoming'),
  ('ASTRO', 'agency_idiq', 'GSA / Army', 'Multi-agency IDIQ for autonomous, robotic, and unmanned systems.', 'https://www.gsa.gov/technology/technology-purchasing-programs/governmentwide-acquisition-contracts/astro', 'active'),
  ('COMET', 'agency_idiq', 'GSA', 'Complex and Operational Management Enterprise Transformation IDIQ.', NULL, 'active'),
  ('GSA Multiple Award Schedule (MAS)', 'schedule', 'GSA', 'Consolidated GSA Schedule covering products, services, and solutions.', 'https://www.gsa.gov/buy-through-us/purchasing-programs/multiple-award-schedule', 'active'),
  ('HCaTS', 'agency_idiq', 'GSA / OPM', 'Human Capital and Training Solutions unrestricted IDIQ.', 'https://www.gsa.gov/technology/technology-purchasing-programs/governmentwide-acquisition-contracts/human-capital-and-training-solutions-hcats', 'active'),
  ('HCaTS Small Business', 'agency_idiq', 'GSA / OPM', 'HCaTS small-business IDIQ.', 'https://www.gsa.gov/technology/technology-purchasing-programs/governmentwide-acquisition-contracts/human-capital-and-training-solutions-hcats', 'active'),
  ('2GIT', 'bpa', 'GSA / Air Force', '2nd Generation IT BPA for commercial IT hardware and software.', NULL, 'active'),
  ('Connections II', 'agency_idiq', 'GSA', 'Telecommunications infrastructure services IDIQ.', NULL, 'expired'),
  ('Enterprise Infrastructure Solutions (EIS)', 'agency_idiq', 'GSA', 'Governmentwide telecom and IT infrastructure vehicle succeeding Networx.', 'https://www.gsa.gov/technology/technology-purchasing-programs/telecommunications-and-network-services/enterprise-infrastructure-solutions', 'active'),
  ('Complex Commercial SATCOM Solutions (CS3)', 'agency_idiq', 'GSA', 'Commercial satellite communications IDIQ.', NULL, 'active'),
  ('STARS II', 'gwac', 'GSA', 'Predecessor 8(a) STARS GWAC.', NULL, 'expired'),

  -- NASA
  ('SEWP VI', 'gwac', 'NASA', 'Solutions for Enterprise-Wide Procurement, sixth generation.', 'https://www.sewp.nasa.gov', 'upcoming'),

  -- NIH NITAAC
  ('CIO-SP3 Small Business', 'gwac', 'NIH NITAAC', 'IT services GWAC restricted to small business.', 'https://nitaac.nih.gov', 'active'),
  ('CIO-CS', 'gwac', 'NIH NITAAC', 'Commodities and solutions GWAC for IT products.', 'https://nitaac.nih.gov', 'active'),
  ('CIO-SP4', 'gwac', 'NIH NITAAC', 'IT services GWAC; successor to CIO-SP3.', 'https://nitaac.nih.gov', 'upcoming'),

  -- DoD
  ('NETCENTS-2', 'agency_idiq', 'Air Force', 'Air Force IT products, services, and application services IDIQ family.', NULL, 'expired'),
  ('SeaPort-NxG', 'agency_idiq', 'Navy', 'Navy engineering, technical, and program-management services IDIQ.', 'https://www.seaport.navy.mil', 'active'),
  ('SeaPort-e', 'agency_idiq', 'Navy', 'Predecessor Navy engineering and technical services IDIQ.', NULL, 'expired'),
  ('ITES-SW2', 'agency_idiq', 'Army', 'Army CHESS software products and related services IDIQ.', NULL, 'active'),
  ('ITES-3H', 'agency_idiq', 'Army', 'Army CHESS IT hardware IDIQ.', NULL, 'active'),
  ('RS3', 'agency_idiq', 'Army', 'Responsive Strategic Sourcing for Services (C4ISR) IDIQ.', NULL, 'active'),
  ('ACCENT', 'agency_idiq', 'Army', 'Army Contracting Enterprise Non-Personal Services IDIQ.', NULL, 'active'),
  ('EWAAC', 'agency_idiq', 'Air Force', 'Enterprise-Wide Agile Acquisition Contract for software services.', NULL, 'active'),
  ('SITE III', 'agency_idiq', 'DIA', 'Solutions for Intelligence Analysis III IDIQ.', NULL, 'active'),
  ('JETS', 'agency_idiq', 'DLA', 'J6 Enterprise Technology Services IDIQ.', NULL, 'active'),
  ('NGEN-R', 'agency_idiq', 'Navy', 'Next Generation Enterprise Network Re-compete IDIQ.', NULL, 'active'),

  -- DHS
  ('EAGLE II', 'agency_idiq', 'DHS', 'Enterprise Acquisition Gateway for Leading-Edge Solutions II.', NULL, 'expired'),
  ('EAGLE Next Gen', 'agency_idiq', 'DHS', 'Successor to EAGLE II for DHS IT services.', NULL, 'upcoming'),
  ('FirstSource III', 'agency_idiq', 'DHS', 'DHS IT commodities small-business IDIQ.', NULL, 'active'),
  ('PACTS III', 'agency_idiq', 'DHS', 'Program Management, Administrative, Clerical, and Technical Services III.', NULL, 'active'),
  ('FLASH', 'agency_idiq', 'DHS', 'DHS Agile software development IDIQ.', NULL, 'expired'),

  -- VA
  ('T4NG', 'agency_idiq', 'VA', 'Transformation Twenty-One Total Technology Next Generation.', 'https://www.va.gov/opal/nac/oa/t4ng.asp', 'active'),
  ('T4NG2', 'agency_idiq', 'VA', 'Successor to T4NG for VA IT services.', NULL, 'upcoming'),

  -- Civilian departments
  ('Evolve', 'agency_idiq', 'State Department', 'Department of State IT services IDIQ.', NULL, 'active'),
  ('TIPSS-4', 'agency_idiq', 'Treasury / IRS', 'Total Information Processing Support Services 4.', NULL, 'active'),
  ('ITSSS-2', 'agency_idiq', 'FBI', 'FBI Information Technology Supplies and Support Services 2.', NULL, 'active'),
  ('SPARC', 'agency_idiq', 'HHS / CMS', 'Strategic Partners Acquisition Readiness Contract for CMS IT.', NULL, 'active'),
  ('ITSS-5', 'agency_idiq', 'DOJ', 'DOJ Information Technology Support Services 5 IDIQ.', NULL, 'active'),
  ('eFAST', 'agency_idiq', 'FAA', 'FAA Electronic Federal Aviation Administration Accelerated and Simplified Tasks IDIQ.', NULL, 'active'),
  ('ARTS-III', 'agency_idiq', 'USPTO', 'USPTO Application Development, Modernization, and O&M services IDIQ.', NULL, 'active'),
  ('ECS III', 'agency_idiq', 'NIH', 'NIH Electronic Commerce Solutions III IDIQ.', NULL, 'active'),
  ('Networx', 'agency_idiq', 'GSA', 'Legacy governmentwide telecom services vehicle (succeeded by EIS).', NULL, 'expired'),
  ('WITS 3', 'agency_idiq', 'GSA', 'Washington Interagency Telecommunications System 3.', NULL, 'expired'),
  ('COMMITS NexGen', 'gwac', 'DOC', 'Legacy Commerce IT services small-business GWAC.', NULL, 'expired')
) AS v(vehicle_name, vehicle_type, managing_agency, description, url, status)
WHERE NOT EXISTS (
  SELECT 1 FROM public.vehicle_registry r
  WHERE r.team_id IS NULL AND lower(r.vehicle_name) = lower(v.vehicle_name)
);
