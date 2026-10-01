# Exam integrity controls

How NACOLM CBT protects a computer-based exam against cheating and malpractice, measured against the main international guidance for computer-based testing. It separates what the software does from what the exam centre has to do, because no software alone makes a sitting secure.

## The guidance we follow

- **ISO/IEC 23988:2007**, *Code of practice for the use of information technology in the delivery of assessments.* Good practice for security of assessment content, candidate authentication, supervision, handling system failures and keeping records.
- **International Test Commission (ITC), Guidelines on Computer-Based and Internet-Delivered Testing (2005).** Defines supervised (proctored) delivery, and covers security of test materials, test-taker authentication and preventing cheating.
- **ITC and Association of Test Publishers, Guidelines for Technology-Based Assessment (2022).** Current practice on test security: lockdown browsers, randomisation and item exposure, proctoring, incident handling and data forensics.
- **National practice** at Nigerian CBT centres (for example JAMB and WAEC): accredited centres, identity checks at the door, seat allocation, CCTV and invigilators in the room. These are physical controls the centre provides.

NACOLM CBT is designed for **supervised delivery at an exam centre**, the strongest mode in the ITC guidelines: an invigilator is in the room, and the exam server runs on the centre's own network with no internet.

## Controls by area

| Area | What the system does | What the centre must do |
|---|---|---|
| **Paper confidentiality before the exam** | The paper travels as an encrypted package (AES-256-GCM). The key is released separately at the start time; possessing the file is not enough. The question order for each candidate can't be predicted before release. | Hand the release key to the invigilator through a sealed or separate channel. |
| **Candidate authentication** | Service number and a 6-digit PIN from the admission slip, checked against the roster. Five wrong PINs lock the number for 10 minutes. | Check photo ID against the admission slip at the door. Keep slips sealed until the sitting. |
| **One candidate, one computer** | A second sign-in for the same candidate is refused while the first computer is active, and flagged to the invigilator. Moving computers needs the invigilator, or the old computer to have been off for 90 seconds. | Allocate seats; the computer label is recorded with each sign-in. |
| **Locked-down workstation** | Optional enforcement of Safe Exam Browser: the exam is only served to a correctly configured SEB, verified with its Config Key on every request. | Install SEB with the exam configuration, or run the browser in kiosk mode under a restricted exam account. Disconnect second displays. |
| **In-exam monitoring** | The kiosk blocks copy, paste, printing, saving, developer tools and similar shortcuts; records leaving full screen, switching window, a second display, Print Screen and large blocks of text appearing at once; watermarks the screen with the candidate's details. | Invigilators walk the room and act on what the console shows. |
| **Response to suspected malpractice** | After a set number of warnings (default 5) the exam pauses until an invigilator unlocks it. The clock keeps running. Every event has a time and detail. | Follow the college's malpractice procedure; the system records, a person decides. |
| **Fairness and accommodations** | Extra time per candidate, with a recorded reason, for system failures or approved access arrangements. The deadline is held on the server, not the candidate's computer. | Approve access arrangements in advance and note them on the roster. |
| **Item exposure** | Each candidate gets a different draw from a larger pool, balanced by topic, with heavily-used questions made less likely. Question and option order are shuffled. | Keep the pool larger than one paper. |
| **System failure** | Answers save as they are given and queue on the computer if the network drops; a computer that restarts carries on with the same paper and deadline. Answer saves wait rather than fail when the room saves at once. | Have spare computers; give extra time for lost minutes. |
| **Integrity of results** | Answers can't change after submission (enforced in the database) and are fingerprinted (SHA-256) at submit. Theory marks proposed by AI are never final: an instructor confirms every mark. | Review flagged scripts before publishing. |
| **Records and audit** | A complete incident log per sitting, downloadable as CSV from the invigilator console. Every action on questions and marks is logged with the person's name. | File the incident log with the exam record. |
| **Access to staff tools** | The invigilator console requires the release key; the AI services are reachable only through the signed-in instructor portal, never from the internet. | Keep the release key and portal passwords confidential. |

## What software can't do

- **Stop a phone or a printed note.** That is the invigilator's job, helped by seating, CCTV and bag checks.
- **Truly lock a normal browser.** A web page can block and record, but the operating system's own keys (for example Alt+Tab or the Windows key) can't be blocked by a page. That is why Safe Exam Browser or kiosk mode is recommended for every real sitting.
- **Prove malpractice from a single event.** A window can lose focus innocently. Events are evidence for the invigilator's judgement, not a verdict.

## Next improvements

- Photo on the candidate's start screen (the placeholder is there) so the invigilator can match face to seat.
- Reset a forgotten PIN from the invigilator console.
- After the exam, flag pairs of candidates whose theory answers are unusually similar (data forensics, as recommended in the 2022 ITC/ATP guidelines).
- Distribute the Safe Exam Browser configuration with the exam package.
