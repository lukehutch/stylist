# Privacy Policy for Stylist

**Effective 26 August 2026.** Stylist is a Google Docs editor add-on written by
Luke Hutchison and published as open source under the MIT license at
[github.com/lukehutch/stylist](https://github.com/lukehutch/stylist).

## The short version

**Stylist collects nothing, transmits nothing, and stores nothing about you.**

It reads the formatting of the document you have open, shows it to you in the
sidebar, and writes back the changes you ask for. That is the whole of it.
Nothing leaves the document. There is no server, no account, no analytics, no
logging, no tracking, no advertising, no profiling, and nothing is ever sold or
shared with anyone. The author cannot see your documents and has no way to.

**No other file in your Google Drive is ever accessed.** Stylist does not hold
a Drive permission of any kind, so it could not list, open, or search your
Drive even if it were asked to. It works only on the single document you have
open in front of you when you open the sidebar.

## The permissions Stylist asks for

Stylist requests exactly two permissions. You can check this yourself: they are
the entire `oauthScopes` list in
[`src/appsscript.json`](src/appsscript.json), and the consent screen you saw
when you installed it should have named these two and nothing else.

### 1. "See, edit, create, and delete all your Google Docs documents"

`https://www.googleapis.com/auth/documents`

**What is accessed:** the document you currently have open — and only that one.

**For what purpose:** to read the formatting Stylist shows you (page size and
margins, named styles, list and bullet definitions, table properties, section
breaks, headers and footers, footnote settings) and to write back the changes
you make.

**What is never touched:** any other document. Every read and write Stylist
performs is addressed to the id returned by
`DocumentApp.getActiveDocument().getId()`, which is Google's own handle for the
document the add-on is currently running inside. There is no code path in
Stylist that names any other document, because there is no way for another
document's id to reach it.

**Why the wording is so alarming, and why it cannot be narrower.** That
sentence is Google's fixed description of the scope, not a description of
Stylist. It states what the permission *permits*, which is the same text every
add-on holding this scope must display.

Google does offer a narrower scope, `documents.currentonly`, which grants
access to the current document alone and would be a perfect fit — except that
Google
[documents it](https://developers.google.com/workspace/add-ons/concepts/editor-scopes)
as "only available within Apps Script Services. This does not include Apps
Script Advanced Services or direct calls to Google Workspace APIs."

Stylist is built on the **Docs advanced service**, which is a direct call to
the Google Docs API. It has to be: the basic Apps Script document service
cannot express most of what Stylist edits — it has no access to list nesting
level definitions, section break properties, header and footer ids, or field
masks. Because those calls go to the Docs API rather than to the built-in
service, Google requires the broad scope and will not accept the narrow one.

So the breadth of this permission is a limitation of Google's permission
system, not a statement about Stylist's behavior. Stylist's restraint is in its
code, which you are welcome to read.

### 2. "Display and run third-party web content in prompts and sidebars inside Google applications"

`https://www.googleapis.com/auth/script.container.ui`

**What is accessed:** nothing. This permission grants no access to any data at
all.

**For what purpose:** it is what allows Stylist to draw a sidebar and add its
entry to the **Extensions** menu. Every editor add-on with a user interface
needs it.

**What is never touched:** everything. The "third-party web content" this scope
names is Stylist's own sidebar, served from Google's servers as part of the
add-on. No content is loaded from anyone else.

## What is stored, and where

Your **presets** — the named formatting settings you save in the Presets tab —
are stored using Apps Script's user properties, which live on Google's servers
inside your own Google account. Only you and this add-on can read them. They
contain formatting settings only: font names, sizes, spacing, margins, indents,
colors, and the names you gave them. They never contain any text from your
documents.

They are removed when you delete them in the Presets tab, or when you uninstall
the add-on and Google discards the script's stored data for your account.

Stylist keeps no other state anywhere.

## Files you download and upload

The **Download** button in the Presets tab builds a JSON file in your browser
and saves it to your computer. Nothing is uploaded anywhere in the process. The
**Upload** button reads a file you choose, in your browser, and applies it. The
file is never sent to any server.

## The one outbound request, and it carries nothing

For completeness, because "transmits nothing" should mean it: the sidebar loads
a font stylesheet from Google's font servers, `fonts.googleapis.com` and
`fonts.gstatic.com`, so that the font picker can draw each font's name in the
font it names.

That request is made by your browser, contains no information about you or your
document, and is subsetted to the letters that can appear in a font name. Like
any web request, it discloses your IP address and browser version to the server
answering it — here, Google, whose servers are already hosting the add-on, the
sidebar, and the document itself, under the Google account you are signed in to
at the time. It is governed by
[Google's privacy policy](https://policies.google.com/privacy).

**In plain terms about the law here.** Under the GDPR an IP address counts as
personal data, and a German court held in 2022 that loading fonts from Google's
servers without consent was an unlawful transfer. That decision concerned an
ordinary public website, where a visitor who has no relationship with Google is
exposed to it unawares. Stylist's sidebar is a different situation: it runs
inside Google Docs, in a document Google is already storing, served by Google
from Google's own servers, to a browser already signed in to Google. Google
learns nothing from the font request that it does not already have.

The developer's view is therefore that this is disclosed rather than hidden,
and harmless in context — but that is a judgment, not a ruling, and you are
entitled to disagree with it. There is at present no way to switch the font
request off while still using Stylist. If this matters to you, please
[say so on the issue tracker](https://github.com/lukehutch/stylist/issues): the
fonts can be bundled with the add-on instead, and the request removed
altogether.

Stylist makes no other network request of any kind. It contains no
`UrlFetchApp` call — the only way Apps Script code can reach the internet — so
the server side of Stylist is incapable of contacting anything.

The links in the sidebar footer, to the project's source on GitHub and to the
author's tip page on Venmo, open only when you click them, and then you are on
those sites under their own privacy policies.

## Google's own role

Your document lives in Google Docs and is processed by Google whether or not
Stylist is installed. Stylist runs on Google's Apps Script platform, inside
your account. Google's handling of your data is covered by
[Google's privacy policy](https://policies.google.com/privacy) and is outside
Stylist's control.

## Your rights under the GDPR and similar laws

This section is here because privacy law requires a notice to contain certain
things whether or not they apply. In Stylist's case almost none of them apply,
and it is worth saying why rather than filling the space with boilerplate.

**Who is responsible for your data.** For the contents of your documents and
for your saved presets, **you are** — or, if you are using a work account, your
employer. Stylist runs entirely inside your own Google account, under your own
Google login. The developer operates no server, receives no copy of anything,
and has no technical means of access. In the GDPR's terms the developer is not
a controller or a processor of that data, because none of it is ever
transmitted to or processed by the developer. Google acts as your provider for
Docs and Apps Script, under your agreement with Google.

The single exception is the font stylesheet described above, which is a request
your browser makes to Google because Stylist's code asks it to. The developer
chose to include it, and so may be treated as a controller for that one narrow
transfer of your IP address to Google. It is described in full in that section,
and nothing about you or your documents travels with it.

**The information a notice is required to state:**

| Required | For Stylist |
|---|---|
| Identity and contact details of the controller | Luke Hutchison, via [the issue tracker](https://github.com/lukehutch/stylist/issues) |
| Contact details of a data protection officer | None. One is required only of public authorities and of organizations carrying out large-scale monitoring or processing of special-category data; Stylist does none of those. |
| Purposes of processing | To display and apply the formatting of the document you have open, and to store the presets you choose to save. Nothing else. |
| Legal basis | Article 6(1)(b) — performing the task you asked for, which is the entire reason you installed it. For the font request, your consent, which you give by installing and opening the sidebar. |
| Legitimate interests, where relied on | None are relied on. |
| Recipients of the data | None. Nothing is disclosed to anyone. The developer is not a recipient. |
| Transfers outside the EEA or UK | None by Stylist. Where Google stores your documents is a matter between you and Google. The font request goes to Google's servers, which may be outside the EEA, under Google's own safeguards. |
| How long data is kept | Document content is not kept at all — it is read, displayed, and discarded when the execution finishes. Presets are kept until you delete them or uninstall the add-on. |
| Right of access, rectification, erasure, restriction, objection, portability | See below. |
| Right to withdraw consent | Uninstall the add-on, or revoke it at [your Google account's third-party access page](https://myaccount.google.com/permissions). Both take effect immediately. |
| Right to complain to a supervisory authority | You may lodge a complaint with the data protection authority of the country you live or work in, whether or not you raise the matter with the developer first. |
| Whether providing data is required | Nothing is required of you. Stylist asks for no information about you at any point — no name, no email, no account, no sign-up. |
| Automated decision-making or profiling | None. Stylist makes no decisions about you and builds no profile of you. |

**Exercising your rights, in practice.** Because the developer holds nothing,
there is nobody to send a data subject request to, and every one of these
rights is something you can already exercise yourself, immediately:

- **Access and portability** — the Presets tab's **Download** button writes
  everything Stylist has stored for you to a JSON file, which is a portable,
  machine-readable format. Your documents are yours in Google Docs.
- **Rectification** — edit any preset in place, or rename it.
- **Erasure** — delete presets individually in the Presets tab, or uninstall
  the add-on, which has Google discard the script's stored data for your
  account.
- **Restriction and objection** — close the sidebar, or uninstall. Stylist does
  nothing at all when it is not open.

If you believe something here is wrong or incomplete, please
[open an issue](https://github.com/lukehutch/stylist/issues); it will be
corrected.

**Children.** Stylist is not directed at children and collects no information
from anyone, of any age.

**California and other US states.** Stylist sells no personal information,
shares none for advertising, and collects none, so there is nothing to opt out
of. The developer is in any case far below every threshold that makes an
operator a "business" under the CCPA.

## Limited Use

Stylist's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. Stylist transfers no user data to
anyone, uses it for no purpose other than performing the formatting changes you
request, and allows no human — including its author — to read it.

## Verifying all of this

You do not have to take any of it on trust. Stylist is open source, and all of
the above is checkable in a few minutes:

- The permissions it asks for: `src/appsscript.json`.
- That it only ever touches the open document: search the source for
  `activeDocId_`, and see that `src/DocModel.js` defines it as
  `DocumentApp.getActiveDocument().getId()`.
- That it never contacts a server: search the source for `UrlFetchApp` and find
  nothing.

## Changes, and how to reach the author

Any change to this policy will be committed to the project's public repository,
where its full history is visible. Questions or concerns:
[open an issue](https://github.com/lukehutch/stylist/issues).
