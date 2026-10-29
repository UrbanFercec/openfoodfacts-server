// Tests for the pull request pre-check run by the pr-precheck workflow.
import assert from "node:assert/strict";
import test from "node:test";

import {findProblems, run} from "../../.github/scripts/pr_precheck.mjs";

const outsider = {association: "CONTRIBUTOR", files: ["lib/ProductOpener/Food.pm"], authorComments: [], linkedIssues: [{number: 1}]};

test("an outside pull request without a linked issue is asked for one", () => {
    assert.equal(findProblems({...outsider, body: "", linkedIssues: []}).length, 1);
});

test("a maintainer pull request without a linked issue passes", () => {
    assert.deepEqual(findProblems({...outsider, association: "MEMBER", body: "", linkedIssues: []}), []);
});

test("a template change needs a screenshot, a video, or the no visible change box", () => {
    const visible = {...outsider, files: ["templates/web/pages/product/product_page.tt.html"]};
    assert.equal(findProblems({...visible, body: "### Screenshot or video\n- [ ] No visible change"}).length, 1);
    assert.deepEqual(findProblems({...visible, body: "- [x] No visible change"}), []);
    assert.deepEqual(findProblems({...visible, body: "![after](https://github.com/user-attachments/assets/abc)"}), []);
    assert.deepEqual(findProblems({...visible, body: "", authorComments: ["<video src=demo.mp4>"]}), []);
});

test("the template's own hints do not count as a screenshot", () => {
    const body = "<!-- Insert a screenshot or a video ![x](a.png) -->\n<!-- - [x] No visible change -->";
    assert.equal(findProblems({...outsider, files: ["scss/_product.scss"], body}).length, 1);
});

test("Perl and test changes do not need a screenshot", () => {
    assert.deepEqual(findProblems({...outsider, files: ["lib/ProductOpener/Display.pm", "tests/js/tagify_init.test.mjs"], body: ""}), []);
});

function fakeGithub({body = "", association = "CONTRIBUTOR", files = [], comments = [], labels = [], issues = []}) {
    const calls = [];
    const record = (name) => async (args) => {
        calls.push([name, args]);
    };
    const github = {
        rest: {
            pulls: {
                get: async () => ({data: {draft: false, user: {login: "author", type: "User"}, body, labels}}),
                listFiles: async () => ({data: files.map((filename) => ({filename}))})
            },
            issues: {
                listComments: async () => ({data: comments}),
                createComment: record("create"),
                updateComment: record("update"),
                deleteComment: record("delete"),
                addLabels: record("label"),
                removeLabel: record("unlabel")
            }
        },
        graphql: async () => ({repository: {pullRequest: {closingIssuesReferences: {nodes: issues}}}})
    };
    const context = {repo: {owner: "o", repo: "r"}, payload: {pull_request: {number: 7, author_association: association}}};
    return {github, context, calls};
}

test("a pull request with problems gets one comment and the label", async () => {
    const fake = fakeGithub({});
    await run(fake);
    assert.deepEqual(fake.calls.map(([name]) => name), ["create", "label"]);
});

test("once fixed, the comment is deleted and the label removed", async () => {
    const comment = {id: 3, user: {type: "Bot", login: "github-actions[bot]"}, body: "<!-- pr-precheck -->\nold"};
    const fake = fakeGithub({labels: [{name: "needs-author"}], comments: [comment], issues: [{number: 1, closedByPullRequestsReferences: {nodes: []}}]});
    await run(fake);
    assert.deepEqual(fake.calls.map(([name]) => name), ["delete", "unlabel"]);
});

test("an unchanged comment is left alone", async () => {
    const first = fakeGithub({});
    await run(first);
    const comment = {id: 3, user: {type: "Bot", login: "github-actions[bot]"}, body: first.calls[0][1].body};
    const fake = fakeGithub({labels: [{name: "needs-author"}], comments: [comment]});
    await run(fake);
    assert.deepEqual(fake.calls, []);
});

test("another open pull request for the same issue is mentioned, without the label", async () => {
    const issues = [{number: 1, closedByPullRequestsReferences: {nodes: [{number: 7, author: {login: "author"}}, {number: 5, author: {login: "someone"}}]}}];
    const fake = fakeGithub({issues});
    await run(fake);
    assert.deepEqual(fake.calls.map(([name]) => name), ["create"]);
    assert.match(fake.calls[0][1].body, /#5 is already open for #1/);
    assert.doesNotMatch(fake.calls[0][1].body, /#7 is/);
});
