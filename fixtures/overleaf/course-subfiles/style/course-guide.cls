\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{course-guide}[2026/01/01 v1.0 Exercise guides]
\LoadClass[11pt]{article}
\RequirePackage{fontspec}
\RequirePackage{graphicx}
\RequirePackage{subfiles}
\RequirePackage{course-extras}

% \guidesetup{<title>} opens a guide: images are in its figures/ folder.
\newcommand\guidesetup[1]{\graphicspath{{figures/}}\section*{#1}}

% \exercise{<slug>}: a numbered heading with no title, labelled ex:<slug>, then exercises/<slug>.tex.
\NewDocumentCommand\exercise{m}{%
  \clearpage\subsection{}\label{ex:#1}\input{exercises/#1}}
