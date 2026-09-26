/*
 * manifesto.js - the text of the Manifesto (the page at /manifesto).
 *
 * The "Manifesto" link at the top of the sidebar opens it full screen, after
 * a short opening sequence. Its settings (the opening image, the green
 * terminal lines and the title card) live in content.js under `manifesto`.
 * This file is only loaded the first time someone opens the page.
 *
 * The text is Markdown, like the page bodies in content.js: paragraphs,
 * [links](https://example.com), *italics*, **bold** and # headings.
 *   - The first "# heading" is the title, and an *italic* line right under it
 *     is the subtitle (while the Manifesto is open, it is also the page's
 *     description; link previews and search engines see index.html's own).
 *     Both are centred on a screen of their own, and the text follows in one
 *     centred column, exactly as written.
 *
 * The text sits inside backticks (`...`), so a bare backtick ends it early
 * and ${ starts a JavaScript placeholder; either one breaks the page. Put a
 * backslash in front: write \` for a backtick and \${ for ${. A plain
 * backslash is written \\.
 */
window.MANIFESTO_MD = `# The Jewel and the Continuity of a Person

*A manifesto for the development of integrated neural prostheses*

I want to build technology that allows an existing person to continue living through changes to the physical system that supports their mind. I intend to devote much of my life to investigating whether this is possible. The person undergoing those changes must remain the beneficiary of the work. Their continued capacity to experience, remember, choose, and develop is the purpose of the project.

This ambition begins with a distinction that discussions of artificial intelligence and mind uploading often leave unresolved. Creating a conscious artificial being and preserving an existing conscious person are separate achievements. A machine could conceivably possess experience without being the continuation of anyone who already exists. Likewise, a system could reproduce a person's behavior and memories without establishing that the original person will experience its future.

My concern is personal survival in this specific sense. I want the individual who enters a procedure to have reason to expect a future as the person who emerges from it. A convincing successor is insufficient evidence of that outcome.

Consider a perfect copy made while the original remains alive. The original continues looking through biological eyes. The copy encounters another environment. Each can acquire memories the other does not possess. Each may sincerely remember the same childhood and regard the same earlier life as its own. There are nevertheless two independently operating systems with potentially conflicting experiences and interests. The copy's testimony cannot, by itself, establish that the original person's subjectivity has continued in the copy.

This argument does not settle every theory of identity. Some philosophers regard psychological continuation as sufficient for survival, or as preserving what matters even when strict identity fails. I recognize that position. My project adopts a more demanding objective: to investigate continuation through transformation of the existing person. The distinction between a conscious upload and an upload that preserves personal identity is already explicit in the philosophical literature. [Chalmers on uploading and personal identity](https://www.consc.net/papers/singularity.pdf)

**My working hypothesis is that an existing person may persist through progressive incorporation of artificial neural components, including some degree of replacement, when those components become part of the ongoing organization through which that person lives.**

This is a hypothesis to investigate. It is not a discovered law of consciousness. It does not establish that every gradual change preserves a person, or that complete biological replacement is possible. It identifies a path whose central design requirement is continuity of the existing system.

Continuity, here, does not mean preserving a fixed inventory of matter. A living brain develops and changes. Nor does it require uninterrupted waking awareness; ordinary sleep and anesthesia would make that definition unsuitable. I mean the persistence and causal development of the organized system, including the capacities and physical states through which its life continues. Preserving a token fragment of original tissue would not, by itself, guarantee this continuity. Neither would describing a procedure as gradual.

I call the proposed research direction the Jewel, in acknowledgment of Greg Egan. In *Learning to Be Me*, a device develops alongside a biological brain, learning to match it before taking control. Its parallel existence brings the distinction between resemblance and continuation into focus. In *Border Guards*, Egan explores progressive replacement instead. These stories provide thought experiments and motivation for a question that must now be approached through research. [Learning to Be Me](https://gwern.net/doc/fiction/science-fiction/1995-egan.pdf), [Border Guards](https://www.gregegan.net/BORDER/Complete/Border.html)

The Jewel I propose would begin as a neural prosthesis that participates in an existing person's capacities. It would learn how a particular living system operates and contribute to that system through reciprocal interaction. Its possible functions include supporting communication between neural populations, restoring a lost capability, or assisting learning. More extensive substitution would remain a later question, contingent on what the earlier work reveals.

The long-term ambition is a person whose mind can be maintained through aging, injury, and the failure of biological components. I want to investigate whether an artificial component can become part of that person's ongoing life deeply enough to support functions that would otherwise be lost. If this process can be extended, the person could continue developing through changes that their original brain alone could not sustain.

Reciprocal interaction alone is insufficient. Two people can communicate continuously without becoming one person. A device that receives brain signals and sends signals back has not thereby become part of the subject who uses it. The research must investigate functional incorporation: whether the device participates in the person's ongoing perception, learning, memory, and action, and how the combined system changes as that participation develops. No single measure of connection strength or information exchange should be mistaken for proof of a unified subject.

The distinction also applies to virtual experience. A living person could, in principle, receive information from an artificial body or virtual environment through an interface. Those inputs could become experiences of the existing person. This possibility does not require creating an independent copy. It also does not establish that receiving information from another conscious system would merge their experiences into one subject.

The project must remain open about the physical requirements of consciousness. Neural computation, chemical signaling, cellular dynamics, and bodily regulation may contribute in ways that current models only partly capture. Computational accounts and biological accounts make different claims about what could be reproduced in another substrate. Research on indicators of AI consciousness offers ways to investigate candidate mechanisms, while biological naturalism challenges the assumption that abstract computation is sufficient. Neither position currently provides a universally accepted construction recipe. [Butlin and colleagues](https://arxiv.org/abs/2308.08708), [Seth on biological naturalism](https://doi.org/10.1017/S0140525X25000032)

For that reason, the Jewel should not be defined in advance as exclusively digital. If relevant functions require biological tissue or particular physical dynamics, the design must accommodate that evidence. Its eventual form could combine living and artificial components. A preference for elegant hardware must not decide a question about the conditions of experience.

There are practical foundations for beginning this work. In a 2021 study, a bidirectional brain-computer interface combined movement decoding with artificial tactile feedback and improved robotic arm control for a participant with tetraplegia. A separate human proof-of-concept study used patterns derived from hippocampal activity to facilitate performance on memory tasks. These experiments establish limited functional benefits from neural interfaces and provide concrete starting points for further investigation. [Flesher and colleagues](https://pmc.ncbi.nlm.nih.gov/articles/PMC8715714/), [Hampson and colleagues](https://pmc.ncbi.nlm.nih.gov/articles/PMC6576290/)

**The first useful Jewel should help a living person do something they value.** Restoring a capability or protecting an existing one would be a meaningful achievement even if complete replacement proved impossible. Research on biological maintenance and repair belongs within this program. Keeping healthy tissue functioning may sometimes be the best way to preserve the system we care about.

The initial technical questions should therefore be narrow enough to answer. Can a proposed component make a causal contribution to a specified function? Can the biological and artificial components adapt together? Can the combined system learn something new and retain it? Does an improvement endure outside the task on which the device was developed? What happens to other capacities when its role changes?

Where appropriate, experiments should compare reciprocal, adaptive integration with simpler forms of assistance. Appropriate controls should distinguish a component that helps produce a result from one that merely predicts it. Before evaluating a design, researchers should specify the benefits expected, the relevant adverse effects, and the observations that would count against their explanation. A sophisticated interface should earn its complexity through demonstrated benefit.

As integration becomes more extensive, the burden of evidence must grow. Task performance alone would be inadequate. Assessment should examine the effects on memory, agency, attention, and other capacities relevant to the intervention, alongside the person's own reports. Stability over time and the ability to adapt matter more than a brief demonstration.

These investigations can test claims about function and candidate mechanisms of consciousness. They cannot presently provide an accepted instrument for detecting whether precisely the same subject persists. A person saying that they feel unchanged is relevant evidence, but an independently created copy could make the same report. The project must keep the limits of its measurements visible, particularly when its central ambition exceeds what those measurements can establish.

The hypothesis must also be allowed to fail in informative ways. If reciprocal integration repeatedly fails to deliver its predicted functional benefits, the architectural claim needs revision. If an omitted biological process proves necessary for a relevant function or well-supported consciousness indicator, the model is incomplete. If increasing dependence on a device destabilizes the capacities it is meant to preserve, expansion is unwarranted. A result that constrains the project can still advance its purpose by showing what a continuing person needs.

**The person must retain meaningful authority over changes to their own mind.** Neural data, memory, and the ability to act deserve protection built into the system. Long-term support and continuity of access become especially important when a person depends on a device. Withdrawal and reversibility should be supported where feasible, while recognizing that dependence may make abrupt removal harmful. Human research requires appropriate clinical expertise, informed consent, and independent oversight proportionate to the intervention.

The same care applies if an artificial component becomes a distinct conscious being. Such a being would have its own possible interests. Its value would not depend on whether it qualified as someone's continuation. Evidence of an independently developing subject would require reconsidering both the architecture and the obligations of its creators. The objection to copying is an objection to an unsupported claim of personal survival; it is not a reason to dismiss the possible reality of a copy's life.

This program can use artificial intelligence wherever it helps explain neural activity, improve models, or design experiments. It does not depend on proving that language models are incapable of consciousness. Nor does it require replaying evolution in full. Its organizing question is more specific: what must be maintained, and what can be changed, for an existing person to continue through physical transformation?

Answering that question will require sustained collaboration across neuroscience, engineering, medicine, and philosophy. It will require learning from people whose lives already depend on assistive technologies. I cannot know in advance whether the work will lead to limited prostheses, durable biological repair, extensive neural integration, or a limit beyond which replacement cannot responsibly proceed. Each possibility must remain available to the evidence.

My commitment is to pursue this problem with enough patience to discover that my first design is wrong. I intend to build useful intermediate technologies, communicate uncertainty plainly, and revise the underlying theory when observation requires it. A lifetime devoted to the work should produce knowledge and benefit along the way, rather than depend entirely on a final achievement that no one can promise.

I want the person who begins this process to be able to keep living through its changes. I want to investigate how far a mind can develop beyond its original biological limitations while preserving the individual undergoing that development. I am willing to make that investigation a life's work. The commitment begins with the living person already here, and with the responsibility to give that person a future they have reason to trust.
`;
