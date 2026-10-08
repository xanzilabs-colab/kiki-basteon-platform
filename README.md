# Kiki × Basteon Platform

Kiki × Basteon is a safety platform that blends **personal protection**, **organisation operations**, and **real-time emergency response** into one system.

- **Kiki** is the user-facing safety companion (mobile/web + wearables).
- **Basteon** is the operations and response backbone (admin, responder, and organisation consoles).
- The platform is designed for both **consumer safety journeys** and **institutional deployments**.

---

## 1) Platform purpose

### Kiki purpose
Kiki helps people stay safer day-to-day, during travel, and in emergencies by combining:
- instant SOS activation,
- wearable integration,
- trusted-person features,
- calming/grounding tools,
- and guided access to professional response networks.

### Basteon purpose
Basteon gives authorised teams the tools to:
- receive and triage alerts in real time,
- track live movement during SOS events,
- manage dispatch operations,
- onboard organisations and responder teams,
- and run safe, auditable operations across branches, units, and users.

---

## 2) Core app sides (personas and consoles)

## A) Customer / Account side (`/account`)
**Primary users:** end users, members, residents, students, staff users, beneficiaries.

### Main capabilities
- **SOS and emergency escalation**
  - initiate emergency alerts
  - upgrade alert type (for example general ↔ medical)
  - queue handling when connectivity is unstable
- **Kiki wearable management**
  - register/link devices
  - device security flows
  - encrypted linking support
- **Trips / travel safety**
  - trip safety monitoring and watchdog flows
- **Buddies**
  - buddy circles and history
  - meeting coordination
  - safe spot discovery/suggestions
- **Guardians / trusted contacts**
  - reach trusted people quickly
- **Profile and personal settings**
  - profile info
  - medical profile fields
  - security options
  - ringtone settings
- **Wellbeing tools**
  - calm and grounding experiences
  - private journal experience (`/w`)

### Games and emotional regulation surfaces
- **Worry Boats**
- **Five Things**
- **Morabaraba**
  - buddy mode
  - solo mode vs **Kiki AI** (Easy / Medium / Hard)

---

## B) Responder Console (`/responder`)
**Primary users:** responders, dispatchers, managers, partner response teams.

### Main capabilities
- realtime incident queue (active + all)
- live map + selected incident context
- alert type filtering and “moving only” filtering
- motion-aware telemetry (moving status, speed, heading, trail)
- organisation-scoped access controls
- operator visibility and status context
- availability management for responder operations
- dispatch actions (role-permitted)

---

## C) Organisation Console (`/organisation`)
**Primary users:** organisation owners/admins/managers/dispatchers.

### Main capabilities
- onboarding checklist (profile, branches, linking, coverage, responders)
- explicit transition from onboarding to full dashboard (“Go to dashboard”)
- post-onboarding tabbed dashboard:
  - **Home** (overview and quick actions)
  - **Beneficiaries** (linked non-ops members)
  - **Responders**
  - **Staff / Members**
  - **Settings**
  - **Configurations**
- account lifecycle actions:
  - create responder/staff accounts
  - generate/reset passwords
  - credential PDF download
- organisation structure:
  - branches/stations
  - units/teams
  - emergency coverage matrix
- linking governance:
  - domain rules management
  - membership type mapping
  - work/student ID regex and approval policy toggles

---

## D) Admin Console (`/admin`)
**Primary users:** platform operators and super-admins.

### Main capabilities
- global overview
- fleet/device administration
- user management
- alert audit log
- buddies safety administration
- community safe-spots moderation
- organisation onboarding/provisioning
- partner responder oversight
- organisation owner credential packaging flows

---

## E) Public/authentication side
**Primary users:** all personas before access.

### Main capabilities
- role-gated sign-in flows:
  - customer login
  - admin login
  - responder login
  - organisation login/signup
- role-based redirection after auth

---

## 3) Real-time emergency and movement pipeline

The platform supports full live-response operations:
- ingestion from wearable/device channel
- phone-originated SOS live updates
- realtime alert and location updates
- map trail rendering and movement smoothing
- shared movement fields across admin and responder views for operational consistency

---

## 4) Roles and access model (high level)

- **User** → customer account features
- **Responder/Dispatcher/Manager/Viewer** → response operations (scoped by organisation)
- **Organisation Owner/Admin/Manager** → organisation dashboard + configuration authority
- **Platform Admin** → global governance and cross-tenant controls

---

## 5) Feature highlights delivered in this codebase

- realtime SOS operations with movement telemetry
- account + device linking architecture
- organisation onboarding and post-onboarding dashboard model
- domain-based and ID-based membership linking controls
- scoped responder data visibility by linked organisation
- credential generation/reset + PDF output for operational handover
- buddies + safe-spots + meeting coordination workflows
- calm and game experiences including Kiki AI solo Morabaraba

---

## 6) Business model and operations strategy

See the dedicated plan:

- [OPERATIONS-BUSINESS-MODEL.md](./OPERATIONS-BUSINESS-MODEL.md)

This document defines:
- sustainable institutional-first revenue strategy,
- how wearables act as access/distribution enablers (not primary profit center),
- contract structures, pricing logic, and operating model.

---

## 7) Technical setup and deployment

For full engineering setup, Supabase migrations, push notifications, cron behavior, and device provisioning details, see:

- [basteon/README.md](./basteon/README.md)
