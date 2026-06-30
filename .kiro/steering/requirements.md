# Requirements Document

## Introduction

The Industrial Tender and Contract Platform is a multi-tenant B2B SaaS product that helps small and mid-size factories and suppliers discover, evaluate, and win government and private tenders and contracts. The Platform continuously aggregates publicly available tender listings from many sources, filters and ranks them by relevance to each business, predicts winning price ranges from historical data, tracks deadlines, organizes bidding documents, and presents everything on a single dashboard.

The Platform is monetized through monthly per-business subscriptions, with higher tiers unlocking additional regional coverage and the Bid Brain price-prediction feature.

This document defines the functional and non-functional requirements for the Platform. It focuses on what the system must do, not how it will be built. Technology direction provided by the stakeholder (Node.js backend, PostgreSQL storage, websocket live updates, web dashboard, always-on cloud hosting, classic white-and-teal UI) is captured as design constraints to be applied during the design phase.

## Glossary

- **Platform**: The complete Industrial Tender and Contract SaaS system, including all subsystems below.
- **Business_Account**: A tenant organization (a factory or supplier) that subscribes to the Platform. All of a tenant's users, data, and documents are isolated from other tenants.
- **Business_User**: A person who signs in under a Business_Account and uses the Platform.
- **Tender**: A single publicly listed procurement opportunity (government or private) with attributes such as title, source portal, category, region, estimated value, and submission deadline.
- **Tender_Radar**: The subsystem that monitors configured source portals and collects new and updated Tender records.
- **Source_Portal**: An external government or private website or feed that publishes public tender listings.
- **Aggregation_Engine**: The component within Tender_Radar that fetches, parses, normalizes, and deduplicates Tender data from Source_Portals.
- **Smart_Match**: The subsystem that filters and ranks Tender records for a Business_Account by region, value, deadline, and product category.
- **Match_Score**: A numeric relevance value between 0 and 100 that Smart_Match assigns to a Tender for a given Business_Account.
- **Product_Category**: A classification of goods or services a Business_Account supplies (for example, mechanical couplings or pipes).
- **Region**: A geographic area used for filtering, such as a city or district (for example, Patna, Gaya, or Samastipur).
- **Bid_Brain**: The premium subsystem that predicts a likely winning price range for a Tender from historical tender outcome data.
- **Historical_Tender_Record**: A stored record of a past tender that includes its awarded price or winning bid value, used to train and run Bid_Brain.
- **Price_Range_Prediction**: The output of Bid_Brain, expressed as a lower bound, an upper bound, and a confidence value.
- **Deadline_Guard**: The subsystem that tracks Tender submission deadlines and triggers alerts.
- **Document_Helper**: The subsystem that stores and organizes a Business_Account's bidding papers, licenses, and forms.
- **Business_Document**: A file (license, certificate, form, or supporting paper) uploaded by a Business_Account for use in bidding.
- **Dashboard**: The single web screen that summarizes live tenders, win chances, money pipeline, and recommended next actions for a Business_Account.
- **Notification_Service**: The subsystem that delivers alerts and messages to Business_Users through configured channels.
- **Notification_Channel**: A delivery method for notifications, such as email, SMS, or in-app message.
- **Subscription_Manager**: The subsystem that handles plans, tiers, recurring billing, and feature entitlements.
- **Subscription_Tier**: A named plan level that defines how many Regions a Business_Account may track and whether Bid_Brain is enabled.
- **Entitlement**: A specific capability granted to a Business_Account by its active Subscription_Tier.
- **Money_Pipeline**: The aggregated estimated value of tenders a Business_Account is currently pursuing, grouped by stage.

## Requirements

### Requirement 1: Business Account Registration and Multi-Tenant Isolation

**User Story:** As a factory owner, I want to register my business and have my data kept separate from other businesses, so that my tender activity and documents stay private.

#### Acceptance Criteria

1. WHEN a new business submits valid registration details, THE Platform SHALL create a Business_Account and an associated owner Business_User.
2. IF a registration request uses an email address already linked to an existing Business_Account, THEN THE Platform SHALL reject the request and return a message stating the email is already registered.
3. THE Platform SHALL store every Tender match, Business_Document, and Price_Range_Prediction with an association to exactly one Business_Account.
4. WHEN a Business_User requests data, THE Platform SHALL return only records associated with that user's Business_Account.
5. WHERE a Business_Account has multiple Business_Users, THE Platform SHALL allow each Business_User to access the shared data of that Business_Account.

### Requirement 2: Authentication and Access Control

**User Story:** As a business owner, I want secure sign-in and role-based access, so that only authorized people can act on my account.

#### Acceptance Criteria

1. WHEN a Business_User submits valid credentials, THE Platform SHALL grant an authenticated session.
2. IF a Business_User submits invalid credentials, THEN THE Platform SHALL deny access and return an authentication error.
3. WHILE a session is inactive for 30 minutes, THE Platform SHALL invalidate the session and require re-authentication.
4. THE Platform SHALL assign each Business_User exactly one role of owner, manager, or viewer.
5. WHERE a Business_User holds the viewer role, THE Platform SHALL permit read access and deny create, update, and delete actions.
6. THE Platform SHALL store Business_User passwords using a one-way cryptographic hash.

### Requirement 3: Tender Radar Aggregation

**User Story:** As a supplier, I want the Platform to continuously collect new tenders from many portals, so that I never miss an opportunity in my category.

#### Acceptance Criteria

1. THE Tender_Radar SHALL poll each configured Source_Portal on a configurable schedule with a default interval of 15 minutes.
2. WHEN the Aggregation_Engine retrieves a tender listing not already stored, THE Tender_Radar SHALL create a new Tender record with its source, title, Product_Category, Region, estimated value, and submission deadline.
3. WHEN the Aggregation_Engine retrieves a tender listing that matches an existing Tender record by source and source identifier, THE Tender_Radar SHALL update the existing record rather than create a duplicate.
4. IF a Source_Portal is unreachable during a poll, THEN THE Tender_Radar SHALL record the failure, retry on the next scheduled interval, and continue polling other Source_Portals.
5. IF a retrieved listing is missing a submission deadline or estimated value, THEN THE Tender_Radar SHALL store the Tender record with the missing field marked as unknown.
6. THE Aggregation_Engine SHALL normalize Region and Product_Category values to the Platform's defined vocabularies before storing a Tender record.

### Requirement 4: Public Data and Legal Compliance

**User Story:** As a business owner, I want assurance that the Platform only uses public tender data and respects source rules, so that my use of the service carries no legal risk.

#### Acceptance Criteria

1. THE Tender_Radar SHALL collect data only from Source_Portals designated as publishing publicly available tender information.
2. WHEN the Aggregation_Engine accesses a Source_Portal, THE Aggregation_Engine SHALL apply the access rate limits configured for that Source_Portal.
3. IF a Source_Portal's published access policy disallows automated retrieval of a resource, THEN THE Aggregation_Engine SHALL skip that resource and log the exclusion.
4. THE Tender_Radar SHALL record the Source_Portal and retrieval timestamp for every stored Tender record.
5. THE Platform SHALL exclude personal contact details of individuals from stored Tender records.

### Requirement 5: Smart Match Filtering and Ranking

**User Story:** As a busy owner, I want tenders filtered and ranked by what matters to me, so that I only review worthwhile opportunities.

#### Acceptance Criteria

1. THE Smart_Match SHALL allow a Business_Account to configure target Regions, Product_Categories, a minimum estimated value, and a maximum estimated value.
2. WHEN a new Tender record is stored, THE Smart_Match SHALL evaluate the Tender against every Business_Account whose configured filters the Tender satisfies.
3. WHEN a Tender satisfies a Business_Account's filters, THE Smart_Match SHALL assign a Match_Score between 0 and 100 based on Region, estimated value, submission deadline, and Product_Category alignment.
4. WHEN a Business_User requests matched tenders, THE Smart_Match SHALL return the matched Tender records ordered by descending Match_Score.
5. WHERE a Tender's Region is outside the Regions permitted by the Business_Account's Subscription_Tier, THE Smart_Match SHALL exclude the Tender from that account's matches.
6. IF a Tender's submission deadline has passed, THEN THE Smart_Match SHALL exclude the Tender from new matches.

### Requirement 6: Historical Tender Data Collection

**User Story:** As a business owner, I want the Platform to build a history of past tender outcomes, so that price prediction has reliable data to learn from.

#### Acceptance Criteria

1. WHEN a Tender reaches its submission deadline and an awarded price becomes available from its Source_Portal, THE Platform SHALL store a Historical_Tender_Record containing the Tender attributes and the awarded price.
2. THE Platform SHALL retain each Historical_Tender_Record for at least 5 years.
3. THE Platform SHALL associate each Historical_Tender_Record with a Product_Category and a Region.
4. IF an awarded price for a closed Tender is unavailable, THEN THE Platform SHALL store the Historical_Tender_Record with the awarded price marked as unknown.

### Requirement 7: Bid Brain Price Prediction

**User Story:** As a bidder, I want a predicted winning price range for a tender, so that I can price my bid competitively.

#### Acceptance Criteria

1. WHERE the Business_Account's Subscription_Tier enables Bid_Brain, THE Bid_Brain SHALL produce a Price_Range_Prediction for a requested Tender.
2. WHERE the Business_Account's Subscription_Tier does not enable Bid_Brain, THE Platform SHALL deny the prediction request and return an upgrade message.
3. WHEN Bid_Brain produces a Price_Range_Prediction, THE Bid_Brain SHALL return a lower bound, an upper bound, and a confidence value between 0 and 1.
4. THE Bid_Brain SHALL compute each Price_Range_Prediction using Historical_Tender_Records matching the Tender's Product_Category and Region.
5. IF fewer than 10 matching Historical_Tender_Records exist for a Tender, THEN THE Bid_Brain SHALL return a result indicating insufficient data instead of a Price_Range_Prediction.
6. THE Bid_Brain SHALL ensure the lower bound of a Price_Range_Prediction is less than or equal to the upper bound.

### Requirement 8: Deadline Guard Tracking and Alerts

**User Story:** As a bidder, I want reminders before tender deadlines, so that I never miss a submission.

#### Acceptance Criteria

1. WHEN a Business_Account saves a Tender to pursue, THE Deadline_Guard SHALL track that Tender's submission deadline for the Business_Account.
2. WHEN a tracked Tender's submission deadline is 7 days away, THE Deadline_Guard SHALL trigger a reminder notification to the Business_Account.
3. WHEN a tracked Tender's submission deadline is 1 day away, THE Deadline_Guard SHALL trigger a final reminder notification to the Business_Account.
4. WHERE a Business_Account has configured custom reminder intervals, THE Deadline_Guard SHALL trigger reminders at those configured intervals.
5. WHEN a tracked Tender's submission deadline has passed, THE Deadline_Guard SHALL mark the tracked Tender as closed for that Business_Account.

### Requirement 9: Document Helper Storage and Organization

**User Story:** As a bidder, I want all my licenses and forms stored and organized, so that I can assemble a bid quickly.

#### Acceptance Criteria

1. WHEN a Business_User uploads a Business_Document, THE Document_Helper SHALL store the file and associate it with the Business_Account.
2. THE Document_Helper SHALL allow a Business_User to label each Business_Document with a document type and an expiry date.
3. WHEN a Business_User requests stored documents, THE Document_Helper SHALL return the Business_Documents associated with that user's Business_Account.
4. WHEN a Business_Document's expiry date is 30 days away, THE Document_Helper SHALL trigger an expiry reminder notification to the Business_Account.
5. WHEN a Business_User deletes a Business_Document, THE Document_Helper SHALL remove the file from active storage for that Business_Account.
6. IF an uploaded file exceeds 50 megabytes, THEN THE Document_Helper SHALL reject the upload and return a size-limit message.

### Requirement 10: Dashboard Overview

**User Story:** As an owner, I want one screen that summarizes my tender activity, so that I can decide what to do next at a glance.

#### Acceptance Criteria

1. WHEN a Business_User opens the Dashboard, THE Dashboard SHALL display the current live matched Tenders for the Business_Account.
2. THE Dashboard SHALL display each pursued Tender's Match_Score as its win-chance indicator.
3. THE Dashboard SHALL display the Money_Pipeline as the total estimated value of pursued Tenders grouped by stage.
4. THE Dashboard SHALL display a list of recommended next actions ordered by submission deadline proximity.
5. WHERE Bid_Brain is enabled for the Business_Account, THE Dashboard SHALL display the Price_Range_Prediction for each pursued Tender that has one.

### Requirement 11: Real-Time Updates

**User Story:** As a user watching the dashboard, I want new tenders and changes to appear without refreshing, so that I always see current information.

#### Acceptance Criteria

1. WHEN a new Tender is matched to a Business_Account, THE Platform SHALL push the matched Tender to that account's active Dashboard sessions within 5 seconds.
2. WHEN a tracked Tender's status changes, THE Platform SHALL push the updated status to that account's active Dashboard sessions within 5 seconds.
3. IF a Dashboard session's live connection drops, THEN THE Platform SHALL attempt to re-establish the connection and resynchronize the displayed data.

### Requirement 12: Notification Delivery

**User Story:** As a user, I want alerts through my preferred channels, so that I act on time.

#### Acceptance Criteria

1. THE Notification_Service SHALL support email, SMS, and in-app Notification_Channels.
2. WHEN a subsystem triggers a notification, THE Notification_Service SHALL deliver the notification through every Notification_Channel the Business_Account has enabled.
3. IF delivery through a Notification_Channel fails, THEN THE Notification_Service SHALL retry delivery up to 3 times and record the final outcome.
4. THE Notification_Service SHALL allow a Business_User to enable or disable each Notification_Channel.

### Requirement 13: Subscription Tiers and Billing

**User Story:** As a business owner, I want to subscribe monthly and pick a tier that fits my needs, so that I pay for the coverage and features I use.

#### Acceptance Criteria

1. THE Subscription_Manager SHALL offer Subscription_Tiers that differ by the number of Regions a Business_Account may track and by whether Bid_Brain is enabled.
2. WHEN a Business_Account subscribes to a Subscription_Tier, THE Subscription_Manager SHALL grant the Entitlements defined by that tier.
3. THE Subscription_Manager SHALL charge each subscribed Business_Account on a monthly recurring cycle.
4. IF a monthly charge fails, THEN THE Subscription_Manager SHALL retry the charge up to 3 times over 7 days and notify the Business_Account of the failure.
5. WHILE a Business_Account's subscription is unpaid beyond the retry period, THE Subscription_Manager SHALL restrict the account to read-only access.
6. WHEN a Business_Account upgrades or downgrades its Subscription_Tier, THE Subscription_Manager SHALL apply the new Entitlements at the start of the next billing cycle.
7. WHERE a Business_Account exceeds the Region count of its Subscription_Tier after a downgrade, THE Subscription_Manager SHALL prompt the Business_Account to select which Regions to retain within the tier limit.

### Requirement 14: Regional Coverage

**User Story:** As a supplier operating in specific districts, I want to track tenders in chosen regions, so that I focus on areas I can serve.

#### Acceptance Criteria

1. THE Platform SHALL support Region selection at the city and district level.
2. WHEN a Business_Account selects target Regions within its Subscription_Tier limit, THE Platform SHALL include Tenders from those Regions in Smart_Match evaluation.
3. WHERE a Business_Account attempts to select more Regions than its Subscription_Tier allows, THE Platform SHALL reject the additional selection and return a tier-limit message.

### Requirement 15: Data Scale and Performance

**User Story:** As a user of a growing platform, I want fast responses even as tender data grows into the millions, so that the service stays usable.

#### Acceptance Criteria

1. THE Platform SHALL store and query at least 10 million Tender records without functional degradation.
2. WHEN a Business_User requests matched tenders, THE Platform SHALL return the first page of results within 2 seconds at the 95th percentile.
3. WHILE the Platform stores 10 million Tender records, THE Smart_Match SHALL evaluate a newly stored Tender against configured Business_Accounts within 10 seconds.

### Requirement 16: Document Security

**User Story:** As a business owner, I want my uploaded documents protected, so that sensitive licenses and forms are not exposed.

#### Acceptance Criteria

1. THE Platform SHALL encrypt every Business_Document at rest.
2. THE Platform SHALL transmit every Business_Document over an encrypted connection.
3. WHEN a Business_User requests a Business_Document, THE Platform SHALL authorize the request against the requester's Business_Account before returning the file.
4. IF a request targets a Business_Document outside the requester's Business_Account, THEN THE Platform SHALL deny the request and return an authorization error.

### Requirement 17: Availability and Reliability

**User Story:** As a subscriber, I want the Platform available around the clock, so that monitoring and alerts never lapse.

#### Acceptance Criteria

1. THE Platform SHALL maintain a monthly availability of at least 99.5 percent for the Dashboard and notification functions.
2. IF a subsystem fails, THEN THE Platform SHALL continue operating the remaining subsystems and record the failure.
3. THE Platform SHALL recover Tender_Radar polling automatically after a subsystem restart without manual intervention.
4. THE Platform SHALL back up stored Tender records, Historical_Tender_Records, and Business_Documents at least once every 24 hours.

## Design Constraints (Stakeholder Technology Direction)

These constraints are recorded for the design phase and do not replace the requirements above:

- The backend should use Node.js to support high-throughput data pulling.
- Persistent storage should use PostgreSQL, sized to hold millions of Tender records.
- Live Dashboard updates should use websockets.
- The product should present a clean web Dashboard with a classic UI: white background and a teal accent color (#0A7A70).
- Hosting should be reliable, always-on cloud infrastructure.
