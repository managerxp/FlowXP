/*
 * Privacy Policy and Terms and Conditions — the real, final text the owner
 * supplied (2026-09-28), replacing the earlier honest-but-draft placeholder.
 * This is not engineering-authored copy: every word below is verbatim from
 * what was provided, reformatted only for the page (bullet markers, section
 * grouping) — nothing paraphrased, summarised or invented.
 *
 * Content lives as plain multi-line strings (renderBody below turns "- " lines
 * into bullet lists and "**text**" lines into bold sub-headings) rather than
 * hand-built JSX per section, because there are ~95 sections between the two
 * documents and one small parser is a much shorter diff than 95 near-identical
 * blocks of markup.
 *
 * One transcription note, flagged rather than silently "fixed": the Privacy
 * Policy text as supplied had a short "46. ACCEPTANCE ... End of Terms and
 * Conditions" fragment appended after its own closing/contact block — that
 * fragment is a duplicate of the Acceptance clause that already properly
 * closes the Terms document below (its section 50), so it was left out of
 * the Privacy page rather than included twice under the wrong document.
 */
import { Container } from '../components/ui.jsx';
import { PageHero } from './parts.jsx';

const EFFECTIVE_DATE = '28 September 2026';

const PRIVACY = [
  ['Overview', `This Privacy Policy explains how ManagerXP Private Limited, the owner and operator of FlowXP ("FlowXP", "ManagerXP", "we", "us", or "our"), collects, uses, stores, processes, protects, transfers, and discloses information in connection with FlowXP.
FlowXP is a multi-industry business management and commerce platform designed to help businesses manage their operations, customers, transactions, employees, products, services, inventory, appointments, memberships, loyalty programs, marketing, analytics, automation, and other business activities.
FlowXP may be used by businesses operating in different industries, including but not limited to:
- Restaurants
- Cafés
- Cloud kitchens
- Food and beverage businesses
- Salons and beauty businesses
- Spas and wellness businesses
- Retail stores
- Supermarkets
- Grocery businesses
- Pharmacies and healthcare-related retail businesses, where legally permitted
- Hardware businesses
- Automobile and motorcycle spare-parts businesses
- Service businesses
- Wholesalers
- Distributors
- Specialty stores
- Multi-location businesses
- Other businesses supported by FlowXP now or in the future
The specific information collected depends on the features, industry module, integrations, and services used by a business.
This Privacy Policy should be read together with the FlowXP Terms and Conditions.`],

  ['1. Who we are', `FlowXP is operated by:
ManagerXP Private Limited
FlowXP is a product/platform operated by ManagerXP Private Limited.
The company may introduce additional applications, modules, services, products, APIs, mobile applications, and other technology under the ManagerXP and FlowXP ecosystem.`],

  ['2. The different types of people whose data may be processed', `FlowXP may process information relating to different categories of individuals.
These may include:
**2.1 Business Owners and Administrators**
People who create or administer a FlowXP business account.
**2.2 Employees and Staff**
People who use FlowXP on behalf of a business.
Examples include:
- Managers
- Cashiers
- Sales staff
- Reception staff
- Kitchen staff
- Service staff
- Inventory staff
- Account staff
- Branch managers
- Administrators
- Other authorized employees
**2.3 Customers and End Users of Businesses**
People who interact with a business using FlowXP.
Depending on the industry, these may include:
- Restaurant customers
- Retail customers
- Salon clients
- Spa customers
- Appointment customers
- Loyalty members
- Subscribers
- Members
- Service customers
- Buyers
- Visitors
- Leads
- Other end customers
**2.4 Suppliers and Business Partners**
FlowXP may process information relating to:
- Suppliers
- Vendors
- Distributors
- Contractors
- Service providers
- Business partners
**2.5 Other Individuals**
FlowXP may also process information relating to individuals whose information is legitimately entered into the platform by an authorized business user.`],

  ['3. FlowXP’s two primary data roles', `FlowXP may process data in different capacities depending on the situation.
**3.1 FlowXP Account and Service Data**
FlowXP may determine the purposes and means of processing information necessary to operate the FlowXP platform, including account administration, subscriptions, security, support, product operation, and platform improvement, subject to applicable law.
**3.2 Business Data**
A business using FlowXP may upload or generate information relating to its customers, employees, suppliers, transactions, members, leads, and other individuals.
In these circumstances, the business generally determines the business purpose for which the information is collected.
The business is responsible for ensuring that it has the necessary legal authority, notice, consent, or other lawful basis required to collect and process that information.
FlowXP processes such information to provide the Services and according to the business's configuration and instructions, subject to applicable law.`],

  ['4. Information we may collect', `We may collect:
- Business name
- Owner name
- Administrator name
- Email address
- Mobile number
- Business address
- Branch addresses
- Country
- State/province
- City
- Postal/PIN code
- Business category
- Business registration information
- GST/tax information
- PAN or other business identification information where required
- Business operating hours
- Currency
- Time zone
- Account credentials
- Subscription information
- Trial information
- Billing information
- Account preferences`],

  ['5. Business profile and configuration data', `A business may configure FlowXP with information such as:
- Business name
- Logo
- Brand information
- Branches
- Departments
- Locations
- Warehouses
- Business hours
- Tax configuration
- Currency
- Pricing rules
- Discount rules
- Roles
- Permissions
- Workflows
- Notifications
- Business preferences
- Industry configuration`],

  ['6. Product and service data', `Depending on the business type, FlowXP may process:
- Product names
- Service names
- SKUs
- Barcodes
- Product codes
- Categories
- Brands
- Variants
- Units
- Prices
- Cost prices
- Taxes
- Discounts
- Images
- Descriptions
- Recipes
- Ingredients
- Service durations
- Packages
- Memberships
- Add-ons
- Combos
- Product/service availability
- Other catalog information`],

  ['7. Inventory and supply-chain data', `Where applicable, FlowXP may process:
- Stock quantities
- Stock movements
- Purchases
- Purchase orders
- Stock transfers
- Stock adjustments
- Warehouses
- Rack locations
- Bin locations
- Batches
- Expiry dates
- Serial numbers
- Product identifiers
- Supplier information
- Reorder levels
- Inventory valuation information
- Purchase costs
For businesses such as spare-parts, hardware, electronics, automotive, and similar businesses, additional product-identification and compatibility information may be processed.`],

  ['8. Customer data', `Businesses may use FlowXP to create and manage customer records.
Depending on the features used, customer information may include:
- Name
- Mobile number
- Email
- Address
- Customer ID
- Date of birth, where voluntarily provided
- Anniversary information
- Preferences
- Purchase history
- Order history
- Service history
- Appointment history
- Invoice history
- Refund/return history
- Membership information
- Loyalty information
- Points
- Rewards
- Coupons
- Offers
- Customer notes
- Feedback
- Communication preferences
- Marketing preferences
- Consent or opt-out records
Businesses should collect only information that is reasonably necessary for their stated business purposes.`],

  ['9. Lead and prospect data', `FlowXP may support customer acquisition and CRM functionality.
Businesses may store:
- Lead name
- Contact details
- Source
- Enquiry information
- Product/service interest
- Follow-up history
- Sales stage
- Communication history
- Appointment information
- Conversion status
- Notes
The business is responsible for ensuring that its collection and use of lead information complies with applicable law.`],

  ['10. Appointment, booking and service data', `Depending on the business, FlowXP may process:
- Appointment date and time
- Booking information
- Service selected
- Assigned employee
- Branch/location
- Customer information
- Appointment status
- Cancellation information
- Rescheduling information
- Service history
- Membership/package information
This may be relevant to salons, spas, clinics or other appointment-based businesses.
Where a business uses FlowXP in a regulated sector, the business remains responsible for ensuring that the information entered is appropriate and legally permitted.`],

  ['11. Employee and staff data', `FlowXP may process:
- Name
- Employee ID
- Contact information
- Login information
- Role
- Department
- Branch
- Permissions
- Work schedules
- Shift information
- Attendance information where supported
- Sales/activity records
- Commission information where supported
- Audit activity
- Account status
Businesses are responsible for their use of employee information and for complying with applicable employment and privacy requirements.`],

  ['12. Supplier and vendor data', `FlowXP may process:
- Supplier name
- Contact person
- Phone number
- Email
- Address
- GST/tax information
- Supplier ID
- Purchase records
- Outstanding balances
- Credit information
- Invoices
- Payment information
- Product information`],

  ['13. Transaction data', `FlowXP may process information relating to business transactions, including:
- Orders
- Invoices
- Receipts
- Sales
- Purchases
- Returns
- Refunds
- Discounts
- Taxes
- GST
- Payment status
- Payment method
- Transaction references
- Outstanding amounts
- Store credit
- Business expenses
- Customer credit
- Supplier balances`],

  ['14. Payment information', `FlowXP may integrate with third-party payment providers.
Depending on the integration, FlowXP may receive:
- Payment status
- Transaction ID
- Payment reference
- Payment method
- Amount
- Refund status
- Settlement information
Where payment processing is performed by an external payment provider, sensitive payment credentials may be handled directly by that provider.
FlowXP does not intend to store complete payment-card credentials unless a specific service expressly requires it and such storage is legally and technically appropriate.`],

  ['15. Loyalty, membership and rewards', `Where enabled by a business, FlowXP may process:
- Membership IDs
- Loyalty IDs
- Points
- Rewards
- Membership tiers
- Benefits
- Points earned
- Points redeemed
- Coupons
- Offers
- Reward expiry
- Redemption history
- Membership status
A business is responsible for establishing and communicating the rules of its loyalty or membership program.`],

  ['16. Marketing and promotional data', `FlowXP may support:
- Campaigns
- Offers
- Coupons
- Promotions
- Customer segments
- Loyalty campaigns
- Promotional eligibility
- Marketing preferences
- Communication preferences
- Campaign history
- Redemption history
Where promotional communications are sent to customers, the business is responsible for ensuring that the communication is lawful and that applicable consent, opt-out, or preference requirements are followed.`],

  ['17. Business analytics', `FlowXP may process business data to provide:
- Sales reports
- Revenue reports
- Inventory analytics
- Purchase analytics
- Customer analytics
- Employee performance reports
- Branch performance
- Product performance
- Service performance
- Appointment analytics
- Loyalty analytics
- Marketing analytics
- Operational analytics
- Financial summaries
- Forecasting
- Other business intelligence`],

  ['18. AI-powered features', `FlowXP may introduce AI-assisted functionality.
Depending on the feature, AI may assist with:
- Business insights
- Sales analysis
- Inventory analysis
- Demand forecasting
- Product recommendations
- Customer insights
- Offer recommendations
- Business summaries
- Automated reporting
- Anomaly detection
- Operational recommendations
- Natural-language analytics
- Workflow automation
AI functionality may process information available within the relevant FlowXP account for the purpose of delivering the feature.
AI outputs are informational and may contain errors.
Businesses remain responsible for reviewing AI-generated information before relying on it for significant business, financial, tax, employment, legal, medical, or other consequential decisions.`],

  ['19. Future AI and automation', `FlowXP may introduce additional AI and automation features.
Before introducing a feature involving personal data for a materially different purpose, FlowXP will provide appropriate notice and obtain consent or rely on another lawful basis where required by applicable law.`],

  ['20. Device and technical information', `FlowXP may automatically collect:
- IP address
- Browser type
- Operating system
- Device type
- Application version
- Session information
- Login timestamps
- Error logs
- Security logs
- Performance information
- Crash information
- Network information
- Approximate location derived from IP where necessary
- Other technical information required to operate and secure the Services`],

  ['21. Location information', `Depending on the feature, FlowXP may process:
- Business address
- Branch location
- Warehouse location
- Service location
- Delivery location
- Location manually entered by a business
- Approximate device/network location where necessary
FlowXP does not intend to continuously track precise personal location unless a particular feature expressly requires such functionality and the appropriate legal and technical requirements are satisfied.`],

  ['22. Communication information', `FlowXP may process communications relating to:
- Customer support
- Account administration
- Service notifications
- Subscription notifications
- Security alerts
- Transactional messages
- Business communications
- Marketing preferences
- Support tickets
- Feedback`],

  ['23. Cookies and similar technologies', `FlowXP may use cookies, SDKs, local storage, analytics technologies, session identifiers, and similar technologies for:
- Authentication
- Security
- Preferences
- Analytics
- Performance
- Product improvement
- Fraud prevention
- Session management
Where legally required, appropriate consent or preference mechanisms will be provided.`],

  ['24. Why FlowXP uses information', `FlowXP may process information to:
- Create and manage accounts
- Provide FlowXP Services
- Process subscriptions
- Process billing
- Provide customer management
- Provide employee management
- Provide inventory management
- Provide sales and billing functionality
- Provide appointment and booking functionality
- Provide loyalty functionality
- Provide offers and promotions
- Provide analytics
- Provide AI functionality
- Provide automation
- Maintain platform security
- Prevent fraud and abuse
- Provide customer support
- Troubleshoot problems
- Maintain backups
- Maintain audit logs
- Improve platform performance
- Develop new features
- Maintain business continuity
- Integrate third-party services
- Comply with legal obligations
- Respond to lawful requests
- Protect rights and property
- Provide future services where appropriately enabled and legally permitted`],

  ['25. Data minimization', `FlowXP aims to collect and process information reasonably necessary for the relevant service or purpose.
Businesses are also responsible for avoiding unnecessary collection of personal information through their FlowXP configuration.
A business should not collect personal information merely because FlowXP provides a field for it.`],

  ['26. Data accuracy', `FlowXP may provide tools that allow businesses and users to update information.
Businesses are responsible for maintaining accurate business, customer, employee, supplier, product, and transaction information entered into the platform.`],

  ['27. How FlowXP shares information', `FlowXP may share information with service providers and other parties where reasonably necessary to provide the Services or comply with law.
These may include:
- Cloud infrastructure providers
- Hosting providers
- Database providers
- Storage providers
- Payment providers
- Email providers
- SMS providers
- Communication platforms
- Analytics providers
- Monitoring providers
- Security providers
- AI service providers
- Backup providers
- Customer-support providers
- Accounting/tax integrations
- Delivery integrations
- Other business integrations
Service providers are expected to process information according to their contractual or authorized purposes.`],

  ['28. Business-configured integrations', `A FlowXP business may choose to connect its account with external services.
The business may instruct FlowXP to send or receive information through those integrations.
Examples include:
- Payment gateways
- Accounting systems
- Delivery platforms
- CRM systems
- Marketing systems
- Messaging services
- Tax platforms
- E-commerce platforms
- Other APIs
The business is responsible for understanding the implications of enabling such integrations.`],

  ['29. Legal disclosures', `FlowXP may disclose information where reasonably necessary to:
- Comply with applicable law
- Comply with lawful governmental orders
- Protect users
- Prevent fraud
- Investigate security incidents
- Enforce contractual rights
- Protect FlowXP infrastructure
- Respond to legal proceedings
- Protect public safety`],

  ['30. Corporate transactions', `If ManagerXP Private Limited undergoes:
- Merger
- Acquisition
- Financing
- Restructuring
- Sale of assets
- Reorganization
- Business transfer
information may be transferred as part of the transaction subject to applicable law.`],

  ['31. Data security', `FlowXP uses reasonable technical and organizational measures designed to protect information.
These may include:
- Encryption in transit
- Access controls
- Authentication
- Role-based access
- Tenant isolation
- Audit logs
- Security monitoring
- Infrastructure controls
- Backup systems
- Incident management
- Access restrictions
- Secure development practices
No internet-connected system can guarantee absolute security.`],

  ['32. Tenant and business data separation', `FlowXP is designed as a multi-tenant platform.
Business data is intended to remain logically separated between different businesses.
Access is intended to be controlled according to:
- Business
- Branch
- Role
- User
- Permission
- Feature
Businesses are responsible for configuring user access correctly.`],

  ['33. Data retention', `FlowXP may retain information for as long as reasonably necessary for:
- Providing Services
- Account management
- Transactions
- Accounting
- Tax requirements
- Legal obligations
- Security
- Fraud prevention
- Dispute resolution
- Audit requirements
- Backup
- Business continuity
- Legitimate operational purposes
Different categories of information may have different retention periods.
Where information is no longer required, FlowXP may delete, anonymize, aggregate, or otherwise securely dispose of it, subject to applicable legal and operational requirements.`],

  ['34. Account closure', `When a business closes its FlowXP account, information may be:
- Deleted
- Anonymized
- Archived
- Retained for legally required periods
- Retained for security or dispute purposes
- Retained temporarily in backups
Deletion from active systems may not immediately remove information from backup systems.`],

  ['35. Data rights', `Subject to applicable law, individuals may have rights relating to their personal data, including rights to:
- Obtain information about processing
- Access applicable personal data
- Correct inaccurate information
- Request erasure where applicable
- Withdraw consent where processing is based on consent
- Raise grievances
- Exercise other rights available under applicable law
The DPDP Act 2023 establishes rights and obligations concerning digital personal data, and the notified 2025 Rules prescribe additional requirements around notices, consent mechanisms, security safeguards, and related processes.`],

  ['36. Business customer responsibility for data rights', `Where FlowXP processes customer or employee information on behalf of a business, the individual may need to contact that business to exercise applicable rights.
FlowXP may assist the business where reasonably necessary and legally required.`],

  ['37. Children’s data', `FlowXP is primarily intended for business use.
Businesses must not knowingly use FlowXP to collect or process children's personal data unless the collection and processing are permitted under applicable law and appropriate safeguards are implemented.
Additional requirements may apply to child-related services.`],

  ['38. Regulated industries', `FlowXP may be used by businesses operating in regulated industries.
Examples may include healthcare-related businesses, pharmacies, financial services, or other regulated businesses.
FlowXP does not automatically assume that a business is legally authorized to collect, store, or process every category of information available through the platform.
The business is responsible for determining:
- What information it may lawfully collect
- What information it should not collect
- What notices are required
- What consents are required
- What sector-specific laws apply
- What retention periods apply
- What security requirements apply`],

  ['39. International data processing', `FlowXP and its service providers may process or store information in India and/or other jurisdictions depending on the infrastructure and services used.
Cross-border processing will be subject to applicable law and required safeguards.`],

  ['40. Aggregated and de-identified data', `FlowXP may create aggregated, statistical, anonymized, or de-identified information where permitted by applicable law.
Such information may be used for:
- Product development
- Platform analytics
- Security
- Performance analysis
- Research
- Benchmarking
- Business intelligence
- Product improvement
FlowXP will not intentionally use appropriately anonymized information to identify an individual.`],

  ['41. Service communications', `FlowXP may send communications necessary to operate the account, including:
- Account alerts
- Security notifications
- Billing notifications
- Subscription notifications
- Trial notifications
- Password/security messages
- Service updates
- Support responses
- Important legal notices
These communications may continue even when a user opts out of promotional communications.`],

  ['42. Marketing communications', `FlowXP may send marketing communications where permitted by applicable law and where the required legal basis or consent exists.
Users may opt out where applicable.
A business using FlowXP for its own marketing is responsible for complying with applicable marketing and communication laws.`],

  ['43. Data breaches', `Where FlowXP becomes aware of a personal-data breach that requires notification under applicable law, FlowXP will follow applicable requirements regarding:
- Assessment
- Containment
- Investigation
- Remediation
- Notification
- Cooperation
The notified DPDP Rules 2025 contain specific security and breach-related obligations and are subject to the phased commencement specified by the Government.`],

  ['44. Privacy by design', `FlowXP aims to incorporate privacy considerations into product development, including:
- Data minimization
- Role-based access
- Tenant separation
- Security controls
- Appropriate retention
- Access management
- Auditability
- Secure integrations
- User controls`],

  ['45. Changes to this Privacy Policy', `FlowXP may update this Privacy Policy as its products, services, industries, technology, and legal requirements evolve.
Material changes may be communicated through:
- Website
- FlowXP application
- Email
- Account notifications
- Other appropriate methods
The latest version will show its effective date.`],

  ['46. Governing law', `This Privacy Policy shall be interpreted in accordance with applicable laws of India, subject to mandatory rights and protections applicable to individuals.`],

  ['Contact', `End of FlowXP Privacy Policy
ManagerXP Private Limited
Product: FlowXP
Email: flowxp.manager@gmail.com
Address: Hiline Complex, 8-2, 644/1/205 F205, Road No. 12, Hyderabad, Telangana 500034
Phone: 096795 49136`]
];

const TERMS = [
  ['Overview', `These Terms and Conditions ("Terms") govern access to and use of FlowXP, a multi-industry business management software platform operated by ManagerXP Private Limited ("FlowXP", "ManagerXP", "we", "us", or "our").
By creating an account, subscribing to, accessing, or using FlowXP, you agree to these Terms.
If you use FlowXP on behalf of a business or organization, you represent that you have authority to accept these Terms on behalf of that business or organization.`],

  ['1. About FlowXP', `FlowXP is a cloud-based business management platform.
Depending on the plan and configuration, FlowXP may provide functionality including:
- Point of sale
- Billing
- Invoicing
- Payments
- GST/tax support
- Products and services
- Inventory
- Purchasing
- Suppliers
- Customers
- CRM
- Leads
- Loyalty
- Memberships
- Offers
- Promotions
- Appointments
- Bookings
- Employee management
- Roles and permissions
- Branch management
- Warehouse management
- Reports
- Analytics
- AI-powered insights
- Automation
- Mobile applications
- Web applications
- APIs
- Third-party integrations
- Industry-specific workflows
Features vary by plan, geography, industry, product version, and availability.`],

  ['2. Multi-industry platform', `FlowXP is designed to support multiple business categories.
The platform may support, among others:
- Food and beverage
- Restaurants
- Cafés
- Cloud kitchens
- Retail
- Supermarkets
- Grocery
- Salons
- Beauty businesses
- Spas
- Wellness businesses
- Pharmacies
- Hardware
- Automotive
- Motorcycle and automobile spare parts
- Wholesale
- Distribution
- Service businesses
- Appointment-based businesses
- Specialty businesses
- Other industries introduced in the future
The inclusion of an industry in this list does not mean that every feature is available for that industry in every location.`],

  ['3. Business account', `A business may create a FlowXP account.
The person creating the account must have authority to represent the business.
The Business Customer is responsible for:
- Account information
- User accounts
- Passwords
- Permissions
- Business configuration
- Data accuracy
- Legal compliance
- Payment obligations`],

  ['4. Account security', `Users must maintain the confidentiality of:
- Passwords
- Authentication credentials
- API keys
- Access tokens
- Security codes
Users must notify FlowXP promptly if unauthorized access is suspected.`],

  ['5. Business users and employees', `A business may create accounts for employees and other authorized users.
The business is responsible for:
- Assigning appropriate roles
- Managing permissions
- Removing former employees
- Protecting account credentials
- Ensuring users act within their authority
FlowXP may record user activity for security, audit, troubleshooting, and operational purposes.`],

  ['6. Business data', `Business Customers may enter or generate information through FlowXP, including:
- Products
- Services
- Customers
- Employees
- Suppliers
- Inventory
- Transactions
- Purchases
- Appointments
- Bookings
- Loyalty data
- Marketing data
- Reports
- Business records
- Other operational data
The Business Customer retains its rights in its Business Data.
The Business Customer grants FlowXP the limited rights necessary to host, process, transmit, store, display, back up, secure, and otherwise process such information for providing the Services.`],

  ['7. Customer information', `Businesses may use FlowXP to manage information about their customers, members, leads, clients, and other individuals.
The Business Customer is responsible for ensuring that:
- The information is lawfully collected
- Appropriate notice is provided
- Required consent is obtained
- Appropriate purposes are communicated
- Marketing preferences are respected
- Data rights are supported where applicable
- Information is not unnecessarily collected`],

  ['8. Industry-specific responsibility', `A Business Customer is responsible for complying with laws applicable to its particular industry.
For example, businesses may have obligations relating to:
- Food safety
- Taxation
- Consumer protection
- Employment
- Healthcare
- Pharmacy operations
- Product warranties
- Automotive services
- Marketing
- Privacy
- Recordkeeping
- Licensing
FlowXP provides software functionality and does not replace professional legal, tax, accounting, medical, regulatory, or compliance advice.`],

  ['9. Products and services', `Businesses may configure FlowXP to manage products and/or services.
The Business Customer is responsible for:
- Product information
- Service information
- Prices
- Taxes
- Availability
- Descriptions
- Discounts
- Regulatory requirements
- Customer communications
FlowXP does not independently verify the legal or commercial accuracy of business-entered information.`],

  ['10. Sales and transactions', `FlowXP may provide functionality for:
- Sales
- Orders
- Invoices
- Receipts
- Returns
- Refunds
- Discounts
- Payments
- Credits
- Customer balances
- Supplier balances
The Business Customer remains responsible for the correctness of its transactions.`],

  ['11. Tax and GST', `FlowXP may provide tools to assist businesses with:
- GST
- Tax calculations
- Tax-inclusive/exclusive pricing
- HSN/SAC
- Tax invoices
- Reports
The Business Customer is responsible for:
- Correct configuration
- Accurate tax information
- Applicable tax rates
- GST compliance
- Tax filings
- Regulatory obligations
FlowXP does not provide tax advice or guarantee tax compliance.`],

  ['12. Inventory', `FlowXP may provide inventory management features including:
- Stock
- Purchases
- Transfers
- Adjustments
- Warehouses
- Bins
- Racks
- Batches
- Expiry
- Serial numbers
- Reorder levels
The Business Customer is responsible for maintaining accurate inventory information.`],

  ['13. Customers, memberships and loyalty', `FlowXP may provide:
- Customer profiles
- Memberships
- Loyalty points
- Rewards
- Coupons
- Offers
- Promotions
- Customer segmentation
The Business Customer is responsible for defining and communicating the applicable terms of its customer programs.`],

  ['14. Appointments and bookings', `Where available, FlowXP may support:
- Appointments
- Bookings
- Scheduling
- Staff assignment
- Service duration
- Cancellations
- Rescheduling
- Membership packages
The Business Customer is responsible for appointment availability, service delivery, cancellations, customer communication, and industry-specific compliance.`],

  ['15. Marketing', `FlowXP may provide tools for:
- Offers
- Campaigns
- Promotions
- Customer segmentation
- Loyalty campaigns
- Communication
The Business Customer is solely responsible for ensuring that marketing communications comply with applicable law and customer preferences.`],

  ['16. Payments', `FlowXP may integrate with third-party payment providers.
Payment services may be subject to separate terms issued by those providers.
FlowXP may receive transaction status and reference information.
FlowXP is not responsible for failures caused by third-party payment providers, banks, networks, or payment infrastructure outside FlowXP's reasonable control.`],

  ['17. Subscriptions', `FlowXP may offer:
- Free plans
- Free trials
- Monthly subscriptions
- Annual subscriptions
- Business plans
- Industry plans
- Add-ons
- Usage-based plans
- Branch-based plans
- Other pricing models
The applicable plan and pricing will be presented at purchase or subscription.`],

  ['18. Free trials', `Where offered, free trials may:
- Have a fixed duration
- Include feature limitations
- Be limited to one trial per business
- Require account verification
- Expire automatically
- Be subject to abuse-prevention measures
FlowXP may modify or discontinue trial programs.`],

  ['19. Subscription billing', `Subscription fees may be billed:
- Monthly
- Annually
- According to usage
- According to number of locations
- According to selected features
- According to another disclosed pricing model
Prices may be changed for future billing periods with appropriate notice where required.`],

  ['20. Cancellation', `A Business Customer may cancel according to the cancellation process provided by FlowXP.
Cancellation may take effect immediately or at the end of the applicable billing period depending on the plan.`],

  ['21. Refunds', `Refunds are subject to:
- The applicable plan
- Purchase terms
- Promotional terms
- Applicable law
- Any refund policy communicated at purchase
Nothing in these Terms limits mandatory refund rights provided by applicable law.`],

  ['22. AI features', `FlowXP may provide AI-powered functionality.
AI may generate:
- Business insights
- Recommendations
- Forecasts
- Summaries
- Reports
- Customer insights
- Inventory recommendations
- Marketing suggestions
- Operational recommendations
AI outputs may contain errors.
Businesses must independently review important outputs before relying on them.
FlowXP does not guarantee that AI-generated information will be complete, accurate, current, or suitable for a particular purpose.`],

  ['23. Automation', `FlowXP may allow businesses to automate:
- Notifications
- Reports
- Customer communications
- Inventory alerts
- Workflows
- Offers
- Operational processes
The Business Customer is responsible for configuring automated workflows appropriately.`],

  ['24. Third-party integrations', `FlowXP may integrate with third-party services.
Examples include:
- Payment providers
- Accounting platforms
- Delivery services
- CRM systems
- Messaging platforms
- Marketing platforms
- Tax systems
- E-commerce systems
- Other APIs
Third-party services are governed by their own terms and policies.
FlowXP does not guarantee the continued availability of third-party integrations.`],

  ['25. Acceptable use', `Users must not:
- Use FlowXP for unlawful purposes
- Commit fraud
- Attempt unauthorized access
- Access another business's data
- Circumvent security controls
- Reverse engineer FlowXP except where legally permitted
- Copy proprietary FlowXP technology
- Scrape or extract data without authorization
- Upload malicious code
- Abuse APIs
- Interfere with platform infrastructure
- Use FlowXP to distribute unlawful content
- Misuse customer information
- Conduct unlawful marketing
- Resell FlowXP without authorization
- Use FlowXP to build a competing service through unauthorized copying or extraction`],

  ['26. Prohibited or restricted information', `Users should not upload information they are not legally authorized to process.
This includes, where applicable:
- Payment credentials
- Passwords belonging to others
- Authentication secrets
- Unnecessary government identity documents
- Unnecessary highly sensitive personal information
- Children's information without appropriate safeguards
- Confidential third-party information without authorization
Industry-specific restrictions may apply.`],

  ['27. Data security', `FlowXP maintains technical and organizational safeguards designed to protect the platform.
However, no software or internet service can guarantee absolute security.
Business Customers remain responsible for:
- User permissions
- Password security
- Device security
- Employee access
- API credentials
- Their own lawful use of Business Data`],

  ['28. Offline functionality', `Certain FlowXP applications may provide offline functionality.
Data may temporarily remain on a device until synchronization occurs.
Users are responsible for securing devices used to access FlowXP.
Synchronization may be delayed or affected by:
- Internet connectivity
- Device failures
- Application errors
- Server availability
- Other technical circumstances`],

  ['29. Data export', `Where available, FlowXP may provide export functionality.
Exports may be subject to:
- Subscription plan
- Technical limitations
- Security controls
- Applicable law
- Format availability
Internal system information, security information, proprietary technology, and certain third-party information may not be exportable.`],

  ['30. Intellectual property', `ManagerXP Private Limited owns or licenses the rights in:
- FlowXP
- Software
- Source code
- Interfaces
- Designs
- APIs
- Documentation
- Algorithms
- AI systems
- Database structures
- Platform architecture
- Trademarks
- Logos
- Branding
- Proprietary technology
Use of FlowXP does not transfer ownership of these rights.`],

  ['31. Customer feedback', `Feedback, suggestions, ideas, and recommendations provided to FlowXP may be used to improve the Services without compensation, provided that such use does not disclose confidential information contrary to applicable obligations.`],

  ['32. Service availability', `FlowXP aims to provide reliable services but does not guarantee uninterrupted availability.
Service interruptions may occur because of:
- Maintenance
- Infrastructure failures
- Internet outages
- Third-party failures
- Security incidents
- Software errors
- Cloud infrastructure issues
- Government actions
- Force majeure
- Other circumstances outside reasonable control`],

  ['33. Backups', `FlowXP may maintain backups for:
- Disaster recovery
- Business continuity
- Security
- Restoration
Backups do not replace a Business Customer's responsibility to maintain records required for its business or by law.`],

  ['34. Suspension', `FlowXP may suspend or restrict access where reasonably necessary because of:
- Non-payment
- Security risk
- Fraud
- Abuse
- Violation of these Terms
- Illegal activity
- Excessive resource use
- Threat to infrastructure
- Legal requirements
Immediate suspension may occur where necessary to protect users, data, systems, or legal interests.`],

  ['35. Termination', `Either party may terminate the relationship according to the applicable subscription or agreement.
Following termination:
- Access may be disabled
- Subscription benefits may end
- Outstanding fees may remain payable
- Data may be retained or deleted according to the Privacy Policy and applicable law`],

  ['36. Confidentiality', `Each party should protect confidential information received from the other party.
Confidential information does not include information that:
- Is publicly available
- Was independently developed
- Was already lawfully known
- Is lawfully obtained from another source
- Must be disclosed by law`],

  ['37. Business customer responsibilities', `The Business Customer is responsible for:
- Lawful operation of its business
- Accurate information
- Tax compliance
- Privacy compliance
- Employee compliance
- Customer communications
- Product/service legality
- Regulatory compliance
- Customer disputes
- Supplier relationships
- Appropriate use of FlowXP`],

  ['38. Customer disputes', `FlowXP provides technology to businesses.
Disputes between a business and its customers regarding:
- Products
- Services
- Prices
- Refunds
- Appointments
- Memberships
- Loyalty
- Offers
- Orders
- Service quality
are generally the responsibility of the business and customer involved.
FlowXP may assist with technical issues relating to the platform where appropriate.`],

  ['39. Disclaimers', `To the maximum extent permitted by law, FlowXP is provided on an "as available" and "as is" basis.
FlowXP does not guarantee:
- Continuous availability
- Error-free operation
- Accuracy of user-entered information
- Accuracy of AI output
- Accuracy of business reports where source data is incorrect
- Availability of third-party integrations
- Tax or regulatory compliance of a particular business
- Suitability for every business purpose`],

  ['40. Limitation of liability', `To the maximum extent permitted by applicable law, ManagerXP Private Limited shall not be liable for indirect, incidental, special, consequential, exemplary, or loss-of-profit damages arising from the use of FlowXP.
To the extent legally permitted, aggregate liability relating to the Services shall be limited to the amount actually paid by the relevant Business Customer for the applicable Services during the period specified in the applicable commercial arrangement or permitted by law.
Nothing in these Terms excludes liability that cannot legally be excluded.`],

  ['41. Indemnification', `To the extent permitted by law, the Business Customer may be responsible for claims arising from:
- Unlawful use of FlowXP
- Violation of these Terms
- Unlawful processing of personal information
- Unauthorized marketing
- Customer disputes
- Employee disputes
- Tax violations
- Fraud
- Business content
- Violation of third-party rights
This clause is subject to applicable law.`],

  ['42. Force majeure', `FlowXP shall not be responsible for delays or failures caused by circumstances beyond reasonable control, including:
- Natural disasters
- War
- Terrorism
- Government action
- Major infrastructure failures
- Telecommunications failures
- Internet outages
- Cloud-provider failures
- Major cybersecurity incidents
- Epidemics or pandemics
- Other extraordinary events`],

  ['43. Changes to FlowXP', `FlowXP may introduce, modify, replace, or discontinue features.
This may include:
- New industries
- New business modules
- Mobile applications
- AI features
- Analytics
- APIs
- Automation
- Integrations
- Customer applications
- Loyalty features
- Other future technology
Where required, material changes will be communicated appropriately.`],

  ['44. Changes to these Terms', `FlowXP may update these Terms as the platform, business, technology, and legal requirements evolve.
Material changes may be communicated through:
- Website
- Application
- Email
- Account notification
- Other reasonable means
The updated Terms will state the effective date.`],

  ['45. Governing law', `These Terms shall be governed by the laws of India, subject to mandatory rights and protections under applicable law.`],

  ['46. Dispute resolution', `The parties should first attempt to resolve disputes through good-faith communication.
If a dispute cannot be resolved informally, the parties may pursue remedies available under applicable law.
Nothing prevents either party from seeking urgent legal relief where legally permitted.`],

  ['47. Severability', `If any provision is found invalid or unenforceable, the remaining provisions shall continue to apply to the maximum extent permitted by law.`],

  ['48. Entire agreement', `These Terms, the FlowXP Privacy Policy, and any applicable subscription/order agreement constitute the agreement governing use of FlowXP unless a separate written agreement expressly applies.`],

  ['49. Contact', `ManagerXP Private Limited
Product: FlowXP
Email: flowxp.manager@gmail.com
Address: Hiline Complex, 8-2, 644/1/205 F205, Road No. 12, Hyderabad, Telangana 500034
Phone: 096795 49136`],

  ['50. Acceptance', `By creating a FlowXP account, accepting these Terms, subscribing to FlowXP, or using the Services, you acknowledge that you have read and agreed to these Terms and the FlowXP Privacy Policy.
If you are accepting these Terms on behalf of a business, you represent that you have authority to bind that business.
End of FlowXP Terms and Conditions`]
];

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/* "- item" -> a bullet list, "**text**" -> a bold sub-heading paragraph,
   anything else -> a plain paragraph. One small parser instead of ~95
   hand-built section layouts for two long, mostly-bulleted legal documents. */
const renderBody = (text) => {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks = [];
  let list = null;
  for (const line of lines) {
    if (line.startsWith('- ')) {
      if (!list) { list = []; blocks.push({ type: 'ul', items: list }); }
      list.push(line.slice(2));
      continue;
    }
    list = null;
    if (line.startsWith('**') && line.endsWith('**')) {
      blocks.push({ type: 'h', text: line.slice(2, -2) });
    } else {
      blocks.push({ type: 'p', text: line });
    }
  }
  return blocks;
};

const Section = ({ title, body }) => (
  <section id={slug(title)} className="scroll-mt-24">
    <h2 className="text-title font-semibold text-ink-900">{title}</h2>
    <div className="mt-2 space-y-2.5 text-body text-ink-500">
      {renderBody(body).map((block, i) => {
        if (block.type === 'ul') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.items.map((item, j) => <li key={j}>{item}</li>)}
            </ul>
          );
        }
        if (block.type === 'h') {
          return <p key={i} className="pt-1 font-semibold text-ink-700">{block.text}</p>;
        }
        return <p key={i}>{block.text}</p>;
      })}
    </div>
  </section>
);

/* Readable prose: a short contents list on the side on wide screens, the
   sections in one comfortable column. */
const LegalPage = ({ heading, intro, sections }) => (
  <>
    <PageHero eyebrow="Legal" title={heading} lead={intro} cta={false} />
    <Container className="grid gap-12 py-14 sm:py-20 lg:grid-cols-12">
      <nav aria-label="Contents" className="lg:col-span-3">
        <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <p className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Contents</p>
          <p className="mt-2 text-caption text-ink-400">Effective {EFFECTIVE_DATE}</p>
          <ul className="mt-3 space-y-2">
            {sections.map(([title]) => (
              <li key={title}><a href={`#${slug(title)}`} className="text-small text-ink-500 hover:text-ink-900">{title}</a></li>
            ))}
          </ul>
        </div>
      </nav>
      <div className="max-w-2xl lg:col-span-9">
        <div className="space-y-10">
          {sections.map(([title, body]) => <Section key={title} title={title} body={body} />)}
        </div>
      </div>
    </Container>
  </>
);

export const Privacy = () => (
  <LegalPage
    heading="Privacy"
    intro="What FlowXP collects, why, and what we will never do with it."
    sections={PRIVACY}
  />
);

export const Terms = () => (
  <LegalPage
    heading="Terms of service"
    intro="The agreement between your business and ManagerXP for the use of FlowXP."
    sections={TERMS}
  />
);
